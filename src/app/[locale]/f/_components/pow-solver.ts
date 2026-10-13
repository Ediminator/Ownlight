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

/**
 * React hook to run the ALTCHA WebCrypto solver in the background on form mount (AC-2, AC-3, AC-12).
 * Handles fetching, background solving, yielding, and waiting for completion if submitted early.
 */
export function useAltchaSolver(slug: string) {
  const [status, setStatus] = useState<PowSolverStatus>('idle');
  const [payloadBase64, setPayloadBase64] = useState<string>('');
  const [waitingForSubmit, setWaitingForSubmit] = useState<boolean>(false);

  const challengeRef = useRef<AltchaChallenge | null>(null);
  const payloadRef = useRef<string>('');
  const issueTimeRef = useRef<number>(0);
  const solvePromiseRef = useRef<Promise<string | null> | null>(null);

  useEffect(() => {
    let isCancelled = false;
    const abortController = new AbortController();

    async function runSolver() {
      setStatus('fetching');
      const challenge = await fetchFormChallenge(slug, abortController.signal);
      if (isCancelled || !challenge) {
        if (!isCancelled) setStatus('error');
        return;
      }

      challengeRef.current = challenge;
      issueTimeRef.current = Date.now();
      setStatus('solving');

      const solvePromise = solveAltchaWebCrypto(challenge, abortController.signal).then(
        (solution) => {
          if (isCancelled || !solution) {
            if (!isCancelled) setStatus('error');
            return null;
          }

          payloadRef.current = solution.base64;
          setPayloadBase64(solution.base64);
          setStatus('verified');
          return solution.base64;
        },
      );

      solvePromiseRef.current = solvePromise;
    }

    void runSolver();

    return () => {
      isCancelled = true;
      abortController.abort();
    };
  }, [slug]);

  /**
   * Called when the user clicks submit.
   * If the solver is still solving, awaits completion before returning the payload (AC-12).
   * Also ensures the minimum 3-second elapsed time threshold (AC-6) has passed before returning.
   */
  const ensureVerifiedPayload = useCallback(async (): Promise<string | null> => {
    if (payloadRef.current && status === 'verified') {
      // Ensure at least 3 seconds have elapsed since challenge issuance (AC-6)
      const elapsed = Date.now() - issueTimeRef.current;
      if (elapsed < 3000) {
        await new Promise((r) => setTimeout(r, 3000 - elapsed));
      }
      return payloadRef.current;
    }

    if (status === 'error' || !solvePromiseRef.current) {
      return null;
    }

    setWaitingForSubmit(true);
    const solved = await solvePromiseRef.current;
    setWaitingForSubmit(false);

    if (solved) {
      const elapsed = Date.now() - issueTimeRef.current;
      if (elapsed < 3000) {
        await new Promise((r) => setTimeout(r, 3000 - elapsed));
      }
      return solved;
    }

    return null;
  }, [status]);

  return {
    status,
    payloadBase64,
    waitingForSubmit,
    ensureVerifiedPayload,
  };
}
