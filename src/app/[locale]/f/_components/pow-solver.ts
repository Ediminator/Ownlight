'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

export interface AltchaChallenge {
  algorithm: string;
  challenge: string;
  maxnumber: number;
  salt: string;
  signature: string;
}

export interface AltchaPayload {
  algorithm: string;
  challenge: string;
  number: number;
  salt: string;
  signature: string;
  txHash: string;
}

export type PowSolverStatus = 'idle' | 'fetching' | 'solving' | 'verified' | 'error';

/**
 * Solves an ALTCHA challenge using the browser's native WebCrypto API (AC-12).
 * Operates purely with crypto.subtle without WebAssembly, eval(), or external scripts.
 * Yields to the browser event loop every 1,000 iterations to maintain UI responsiveness.
 */
export async function solveAltchaWebCrypto(
  challenge: AltchaChallenge,
  signal?: AbortSignal,
  onProgress?: (tested: number) => void,
): Promise<{ payload: AltchaPayload; base64: string } | null> {
  const encoder = new TextEncoder();
  const salt = challenge.salt;
  const targetChallenge = challenge.challenge.toLowerCase();
  const max = challenge.maxnumber > 0 ? challenge.maxnumber : 50000;

  const subtle = globalThis.crypto.subtle;

  for (let n = 0; n <= max; n++) {
    if (signal?.aborted) {
      return null;
    }

    // Yield to the event loop every 1,000 iterations
    if (n > 0 && n % 1000 === 0) {
      if (onProgress) {
        onProgress(n);
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    const data = encoder.encode(salt + String(n));
    const hashBuffer = await subtle.digest('SHA-256', data);
    const hashArray = new Uint8Array(hashBuffer);

    let hex = '';
    for (const byte of hashArray) {
      hex += byte.toString(16).padStart(2, '0');
    }

    if (hex === targetChallenge) {
      const payload: AltchaPayload = {
        algorithm: challenge.algorithm,
        challenge: challenge.challenge,
        number: n,
        salt: challenge.salt,
        signature: challenge.signature,
        txHash: '',
      };

      const jsonStr = JSON.stringify(payload);
      const base64 =
        typeof btoa === 'function' ? btoa(jsonStr) : Buffer.from(jsonStr).toString('base64');
      return { payload, base64 };
    }
  }

  return null;
}

/**
 * Fetches an ALTCHA challenge from the public challenge endpoint (AC-1).
 */
export async function fetchFormChallenge(
  slug: string,
  signal?: AbortSignal,
): Promise<AltchaChallenge | null> {
  try {
    const res = await fetch(`/api/public/forms/${encodeURIComponent(slug)}/challenge`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      cache: 'no-store',
      signal,
    });

    if (!res.ok) {
      return null;
    }

    const data = (await res.json()) as AltchaChallenge | null;
    if (!data?.challenge || !data.salt || !data.signature) {
      return null;
    }

    return data;
  } catch {
    return null;
  }
}

export interface AltchaSolverControllerOptions {
  fetchChallenge?: (slug: string, signal?: AbortSignal) => Promise<AltchaChallenge | null>;
  solveChallenge?: (
    challenge: AltchaChallenge,
    signal?: AbortSignal,
  ) => Promise<{ payload: AltchaPayload; base64: string } | null>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  onStatusChange?: (status: PowSolverStatus) => void;
  onPayloadChange?: (base64: string) => void;
}

/**
 * Headless controller for the ALTCHA challenge fetch and WebCrypto solver pipeline (AC-2, AC-3, AC-12, I1-U01).
 * Completely decoupled from React lifecycle to enable robust unit testing and verification.
 */
export function createAltchaSolverController(
  slug: string,
  options: AltchaSolverControllerOptions = {},
) {
  const fetchFn = options.fetchChallenge ?? fetchFormChallenge;
  const solveFn = options.solveChallenge ?? solveAltchaWebCrypto;
  const sleepFn = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const nowFn = options.now ?? (() => Date.now());

  let status: PowSolverStatus = 'idle';
  let payloadBase64 = '';
  let waitingForSubmit = false;
  let issueTime = 0;
  let pipelinePromise: Promise<string | null> | null = null;
  const abortController = new AbortController();

  function updateStatus(newStatus: PowSolverStatus) {
    status = newStatus;
    options.onStatusChange?.(newStatus);
  }

  function runPipeline(): Promise<string | null> {
    updateStatus('fetching');
    const promise = (async () => {
      try {
        const challenge = await fetchFn(slug, abortController.signal);
        if (abortController.signal.aborted || !challenge) {
          if (!abortController.signal.aborted) updateStatus('error');
          return null;
        }

        let issuedAt = nowFn();
        const saltParamMatch = /[?&]issued=(\d+)/.exec(challenge.salt);
        const issuedStr = saltParamMatch?.[1];
        if (issuedStr) {
          const parsed = Number.parseInt(issuedStr, 10);
          if (Number.isFinite(parsed) && parsed > 0) {
            issuedAt = parsed;
          }
        }
        issueTime = issuedAt;
        updateStatus('solving');

        const solution = await solveFn(challenge, abortController.signal);
        if (!solution) {
          updateStatus('error');
          return null;
        }

        payloadBase64 = solution.base64;
        options.onPayloadChange?.(solution.base64);
        updateStatus('verified');
        return solution.base64;
      } catch {
        updateStatus('error');
        return null;
      }
    })();

    // solvePromiseRef/pipelinePromise encompasses BOTH challenge fetch AND solve (I1-U01)
    pipelinePromise = promise;
    return promise;
  }

  function getRemainingDurationMs(): number {
    if (!issueTime) return 3050;
    return Math.max(0, 3050 - (nowFn() - issueTime));
  }

  /**
   * Called when the user submits the form.
   * If the challenge is still fetching or solving, awaits completion before returning (I1-U01).
   * Enforces the minimum 3-second elapsed time threshold (AC-6, I1-U01) before resolving.
   */
  async function ensureVerifiedPayload(): Promise<string | null> {
    waitingForSubmit = true;
    try {
      let payload = payloadBase64;
      if (!payload) {
        if (status === 'error' || !pipelinePromise) {
          return null;
        }
        payload = (await pipelinePromise) ?? '';
      }

      if (!payload) {
        return null;
      }

      const remaining = getRemainingDurationMs();
      if (remaining > 0) {
        await sleepFn(remaining);
      }

      return payload;
    } finally {
      waitingForSubmit = false;
    }
  }

  function abort() {
    abortController.abort();
  }

  return {
    getStatus: () => status,
    getPayloadBase64: () => payloadBase64,
    isWaitingForSubmit: () => waitingForSubmit,
    getIssueTime: () => issueTime,
    getRemainingDurationMs,
    ensureVerifiedPayload,
    start: runPipeline,
    abort,
  };
}

/**
 * React hook to run the ALTCHA WebCrypto solver in the background on form mount (AC-2, AC-3, AC-12, I1-U01).
 * Handles fetching, background solving, yielding, and waiting for completion if submitted early.
 */
export function useAltchaSolver(slug: string) {
  const [status, setStatus] = useState<PowSolverStatus>('idle');
  const [payloadBase64, setPayloadBase64] = useState<string>('');
  const [waitingForSubmit, setWaitingForSubmit] = useState<boolean>(false);
  const controllerRef = useRef<ReturnType<typeof createAltchaSolverController> | null>(null);

  useEffect(() => {
    const controller = createAltchaSolverController(slug, {
      onStatusChange: setStatus,
      onPayloadChange: setPayloadBase64,
    });
    controllerRef.current = controller;
    void controller.start();

    return () => {
      controller.abort();
    };
  }, [slug]);

  const getRemainingDurationMs = useCallback((): number => {
    return controllerRef.current?.getRemainingDurationMs() ?? 3050;
  }, []);

  const ensureVerifiedPayload = useCallback(async (): Promise<string | null> => {
    if (!controllerRef.current) return null;
    setWaitingForSubmit(true);
    try {
      return await controllerRef.current.ensureVerifiedPayload();
    } finally {
      setWaitingForSubmit(false);
    }
  }, []);

  return {
    status,
    payloadBase64,
    waitingForSubmit,
    getRemainingDurationMs,
    ensureVerifiedPayload,
  };
}
