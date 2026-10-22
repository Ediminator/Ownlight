import type {
  AvailabilitySchedule,
  AvailabilityOverride,
  BookingType,
  BookingLocationType,
} from '@/server/db/schema/calendar';
import {
  updateWeeklyScheduleAction,
  createDateOverrideAction,
  deleteDateOverrideAction,
  createBookingTypeAction,
  updateBookingTypeAction,
  deleteBookingTypeAction,
} from '@/server/calendar/availability-actions';
import { generateSlug, isValidSlug } from '@/lib/slug';
import { WEEKDAY_ORDER, isTimeRangeValid, type ColorOption } from './availability-helpers';
import type {
  UpdateAvailabilitySchedulesInput,
  CreateBookingTypeInput,
  UpdateBookingTypeInput,
} from '@/server/calendar/schema';

// ==========================================
// Weekly Schedule View-Model Types & Logic
// ==========================================

export interface DayScheduleState {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  isActive: boolean;
}

/**
 * Initializes the 7-day schedule map (0 = Sunday to 6 = Saturday)
 * from DB schedules or defaults (Monday to Friday active 09:00 - 17:00).
 */
export function buildInitialScheduleMap(
  initialSchedules: AvailabilitySchedule[],
): Record<number, DayScheduleState> {
  const map: Record<number, DayScheduleState> = {};
  for (let day = 0; day <= 6; day++) {
    const found = initialSchedules.find((s) => s.dayOfWeek === day);
    map[day] = {
      dayOfWeek: day,
      startTime: found?.startTime ?? '09:00',
      endTime: found?.endTime ?? '17:00',
      isActive: found ? found.isActive : day >= 1 && day <= 5,
    };
  }
  return map;
}

/**
 * Toggles a day's active status.
 */
export function toggleWeekdayActive(
  schedules: Record<number, DayScheduleState>,
  dayOfWeek: number,
): Record<number, DayScheduleState> {
  const current = schedules[dayOfWeek] ?? {
    dayOfWeek,
    startTime: '09:00',
    endTime: '17:00',
    isActive: false,
  };
  return {
    ...schedules,
    [dayOfWeek]: {
      ...current,
      isActive: !current.isActive,
    },
  };
}

/**
 * Updates a day's start or end time.
 */
export function updateWeekdayTime(
  schedules: Record<number, DayScheduleState>,
  dayOfWeek: number,
  field: 'startTime' | 'endTime',
  value: string,
): Record<number, DayScheduleState> {
  const current = schedules[dayOfWeek] ?? {
    dayOfWeek,
    startTime: '09:00',
    endTime: '17:00',
    isActive: false,
  };
  return {
    ...schedules,
    [dayOfWeek]: {
      ...current,
      [field]: value,
    },
  };
}

/**
 * Validates that all active schedule days have startTime < endTime.
 */
export function validateWeeklyScheduleRanges(
  schedules: Record<number, DayScheduleState>,
  errorMessage: string,
): Record<number, string> {
  const errors: Record<number, string> = {};
  for (const day of WEEKDAY_ORDER) {
    const item = schedules[day];
    if (item?.isActive) {
      if (!isTimeRangeValid(item.startTime, item.endTime)) {
        errors[day] = errorMessage;
      }
    }
  }
  return errors;
}

/**
 * Serializes the schedule map to payload array for server action.
 */
export function serializeWeeklySchedules(
  schedules: Record<number, DayScheduleState>,
): UpdateAvailabilitySchedulesInput {
  return {
    schedules: WEEKDAY_ORDER.map((day) => {
      const item = schedules[day] ?? {
        dayOfWeek: day,
        startTime: '09:00',
        endTime: '17:00',
        isActive: false,
      };
      return {
        dayOfWeek: item.dayOfWeek,
        startTime: item.startTime,
        endTime: item.endTime,
        isActive: item.isActive,
      };
    }),
  };
}

/**
 * Submits the weekly schedule updates to the server action.
 */
export async function submitWeeklyScheduleUpdate(
  schedules: Record<number, DayScheduleState>,
  dispatchAction: typeof updateWeeklyScheduleAction = updateWeeklyScheduleAction,
): Promise<{ success: boolean; error?: string }> {
  try {
    const payload = serializeWeeklySchedules(schedules);
    const res = await dispatchAction(payload);
    if (!res.success) {
      return { success: false, error: res.error };
    }
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to update weekly schedule',
    };
  }
}

// ==========================================
// Date Overrides View-Model Types & Logic
// ==========================================

export interface OverrideFormState {
  date: string;
  isUnavailable: boolean;
  startTime: string;
  endTime: string;
  reason: string;
}

export function getInitialOverrideFormState(): OverrideFormState {
  return {
    date: '',
    isUnavailable: true,
    startTime: '09:00',
    endTime: '17:00',
    reason: '',
  };
}

/**
 * Validates date override form input.
 */
export function validateDateOverrideFormState(
  values: OverrideFormState,
  messages: { dateRequired: string; invalidDate: string; invalidRange: string },
): string | null {
  if (!values.date) {
    return messages.dateRequired;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(values.date)) {
    return messages.invalidDate;
  }
  if (!values.isUnavailable) {
    if (
      !values.startTime ||
      !values.endTime ||
      !isTimeRangeValid(values.startTime, values.endTime)
    ) {
      return messages.invalidRange;
    }
  }
  return null;
}

/**
 * Filters and sorts overrides by date ascending.
 * If todayStr is provided, only overrides on or after today are returned.
 */
export function filterAndSortUpcomingOverrides(
  overrides: AvailabilityOverride[],
  todayStr?: string,
): AvailabilityOverride[] {
  const filtered = todayStr ? overrides.filter((o) => o.date >= todayStr) : [...overrides];
  return filtered.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Submits a new date override to the server action.
 */
export async function submitDateOverrideCreate(
  values: OverrideFormState,
  dispatchAction: typeof createDateOverrideAction = createDateOverrideAction,
): Promise<{ success: boolean; data?: AvailabilityOverride; error?: string }> {
  try {
    const payload = {
      date: values.date,
      isUnavailable: values.isUnavailable,
      startTime: values.isUnavailable ? null : values.startTime,
      endTime: values.isUnavailable ? null : values.endTime,
      reason: values.reason.trim() || null,
    };
    const res = await dispatchAction(payload);
    if (!res.success) {
      return { success: false, error: res.error };
    }
    return { success: true, data: res.data };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to create override',
    };
  }
}

/**
 * Submits deletion of a date override.
 */
export async function submitDateOverrideDelete(
  id: string,
  dispatchAction: typeof deleteDateOverrideAction = deleteDateOverrideAction,
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await dispatchAction({ id });
    if (!res.success) {
      return { success: false, error: res.error };
    }
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to delete override',
    };
  }
}

// ==========================================
// Booking Types View-Model Types & Logic
// ==========================================

export interface BookingTypeFormState {
  title: string;
  slug: string;
  slugManuallyEdited: boolean;
  description: string;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  minNoticeHours: number;
  maxFutureDays: number;
  locationType: BookingLocationType;
  locationDetails: string;
  color: ColorOption;
  isActive: boolean;
}

export function getInitialBookingTypeFormState(item?: BookingType | null): BookingTypeFormState {
  if (item) {
    return {
      title: item.title,
      slug: item.slug,
      slugManuallyEdited: true,
      description: item.description ?? '',
      durationMinutes: item.durationMinutes,
      bufferBeforeMinutes: item.bufferBeforeMinutes,
      bufferAfterMinutes: item.bufferAfterMinutes,
      minNoticeHours: item.minNoticeHours,
      maxFutureDays: item.maxFutureDays,
      locationType: item.locationType,
      locationDetails: item.locationDetails ?? '',
      color: item.color as ColorOption,
      isActive: item.isActive,
    };
  }
  return {
    title: '',
    slug: '',
    slugManuallyEdited: false,
    description: '',
    durationMinutes: 30,
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 15,
    minNoticeHours: 24,
    maxFutureDays: 60,
    locationType: 'google_meet',
    locationDetails: '',
    color: 'indigo',
    isActive: true,
  };
}

/**
 * Derives the slug automatically from the title unless manually edited or editing an existing item.
 */
export function computeBookingTypeSlug(
  title: string,
  currentSlug: string,
  slugManuallyEdited: boolean,
  isEditing: boolean,
): string {
  if (!slugManuallyEdited && !isEditing) {
    return generateSlug(title);
  }
  return currentSlug;
}

/**
 * Validates booking type form values.
 */
export function validateBookingTypeFormState(
  values: BookingTypeFormState,
  messages: {
    titleRequired: string;
    slugRequired: string;
    slugInvalid: string;
    durationMin: string;
    noticeMin: string;
    horizonMin: string;
  },
): string | null {
  if (!values.title.trim()) {
    return messages.titleRequired;
  }
  if (!values.slug.trim()) {
    return messages.slugRequired;
  }
  if (!isValidSlug(values.slug)) {
    return messages.slugInvalid;
  }
  if (!values.durationMinutes || values.durationMinutes < 5) {
    return messages.durationMin;
  }
  if (values.minNoticeHours < 0) {
    return messages.noticeMin;
  }
  if (!values.maxFutureDays || values.maxFutureDays < 1) {
    return messages.horizonMin;
  }
  return null;
}

/**
 * Serializes form state to CreateBookingTypeInput.
 */
export function serializeCreateBookingTypePayload(
  values: BookingTypeFormState,
): CreateBookingTypeInput {
  return {
    title: values.title.trim(),
    slug: values.slug.trim(),
    description: values.description.trim() || null,
    durationMinutes: values.durationMinutes,
    bufferBeforeMinutes: values.bufferBeforeMinutes,
    bufferAfterMinutes: values.bufferAfterMinutes,
    minNoticeHours: values.minNoticeHours,
    maxFutureDays: values.maxFutureDays,
    locationType: values.locationType,
    locationDetails: values.locationDetails.trim() || null,
    color: values.color,
    isActive: values.isActive,
  };
}

/**
 * Serializes form state to UpdateBookingTypeInput.
 */
export function serializeUpdateBookingTypePayload(
  values: BookingTypeFormState,
): UpdateBookingTypeInput {
  return {
    title: values.title.trim(),
    slug: values.slug.trim(),
    description: values.description.trim() || null,
    durationMinutes: values.durationMinutes,
    bufferBeforeMinutes: values.bufferBeforeMinutes,
    bufferAfterMinutes: values.bufferAfterMinutes,
    minNoticeHours: values.minNoticeHours,
    maxFutureDays: values.maxFutureDays,
    locationType: values.locationType,
    locationDetails: values.locationDetails.trim() || null,
    color: values.color,
    isActive: values.isActive,
  };
}

/**
 * Submits creation of a new booking type.
 */
export async function submitBookingTypeCreate(
  values: BookingTypeFormState,
  dispatchAction: typeof createBookingTypeAction = createBookingTypeAction,
): Promise<{ success: boolean; data?: BookingType; error?: string }> {
  try {
    const payload = serializeCreateBookingTypePayload(values);
    const res = await dispatchAction(payload);
    if (!res.success) {
      return { success: false, error: res.error };
    }
    return { success: true, data: res.data };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to create booking type',
    };
  }
}

/**
 * Submits update of an existing booking type.
 */
export async function submitBookingTypeUpdate(
  id: string,
  values: BookingTypeFormState,
  dispatchAction: typeof updateBookingTypeAction = updateBookingTypeAction,
): Promise<{ success: boolean; data?: BookingType; error?: string }> {
  try {
    const payload = serializeUpdateBookingTypePayload(values);
    const res = await dispatchAction(id, payload);
    if (!res.success) {
      return { success: false, error: res.error };
    }
    return { success: true, data: res.data };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to update booking type',
    };
  }
}

/**
 * Submits deletion of a booking type.
 */
export async function submitBookingTypeDelete(
  id: string,
  dispatchAction: typeof deleteBookingTypeAction = deleteBookingTypeAction,
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await dispatchAction({ id });
    if (!res.success) {
      return { success: false, error: res.error };
    }
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to delete booking type',
    };
  }
}

/**
 * Copies public booking link to clipboard.
 */
export async function copyPublicBookingLink(
  slug: string,
  origin: string = typeof window !== 'undefined' ? window.location.origin : '',
  writeText?: (text: string) => Promise<void>,
): Promise<boolean> {
  const fullUrl = `${origin}/book/${slug}`;
  try {
    if (writeText) {
      await writeText(fullUrl);
      return true;
    }
    if (typeof navigator !== 'undefined') {
      await navigator.clipboard.writeText(fullUrl);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Returns icon type and label key for location type.
 */
export function getBookingLocationBadgeInfo(locationType: BookingLocationType): {
  iconType: 'video' | 'phone' | 'map-pin';
  labelKey: string;
} {
  switch (locationType) {
    case 'phone':
      return { iconType: 'phone', labelKey: 'locationPhone' };
    case 'in_person':
      return { iconType: 'map-pin', labelKey: 'locationInPerson' };
    case 'google_meet':
    default:
      return { iconType: 'video', labelKey: 'locationGoogleMeet' };
  }
}

// ==========================================
// View-Model Reducers & State Management
// ==========================================

export interface WeeklyScheduleViewState {
  schedules: Record<number, DayScheduleState>;
  clientErrors: Record<number, string>;
  isSubmitting: boolean;
  notification: { type: 'success' | 'error'; message: string } | null;
}

export type WeeklyScheduleAction =
  | { type: 'TOGGLE_DAY'; dayOfWeek: number; errorMsg: string }
  | {
      type: 'CHANGE_TIME';
      dayOfWeek: number;
      field: 'startTime' | 'endTime';
      value: string;
      errorMsg: string;
    }
  | { type: 'SET_SUBMITTING'; isSubmitting: boolean }
  | { type: 'SET_CLIENT_ERRORS'; errors: Record<number, string> }
  | {
      type: 'SET_NOTIFICATION';
      notification: { type: 'success' | 'error'; message: string } | null;
    };

export function createInitialWeeklyScheduleState(
  initialSchedules: AvailabilitySchedule[],
  initialNotification: { type: 'success' | 'error'; message: string } | null = null,
  initialClientErrors: Record<number, string> = {},
): WeeklyScheduleViewState {
  return {
    schedules: buildInitialScheduleMap(initialSchedules),
    clientErrors: initialClientErrors,
    isSubmitting: false,
    notification: initialNotification,
  };
}

export function weeklyScheduleReducer(
  state: WeeklyScheduleViewState,
  action: WeeklyScheduleAction,
): WeeklyScheduleViewState {
  switch (action.type) {
    case 'TOGGLE_DAY': {
      const updated = toggleWeekdayActive(state.schedules, action.dayOfWeek);
      return {
        ...state,
        schedules: updated,
        clientErrors: validateWeeklyScheduleRanges(updated, action.errorMsg),
      };
    }
    case 'CHANGE_TIME': {
      const updated = updateWeekdayTime(
        state.schedules,
        action.dayOfWeek,
        action.field,
        action.value,
      );
      return {
        ...state,
        schedules: updated,
        clientErrors: validateWeeklyScheduleRanges(updated, action.errorMsg),
      };
    }
    case 'SET_SUBMITTING':
      return { ...state, isSubmitting: action.isSubmitting };
    case 'SET_CLIENT_ERRORS':
      return { ...state, clientErrors: action.errors };
    case 'SET_NOTIFICATION':
      return { ...state, notification: action.notification };
    default:
      return state;
  }
}

export interface DateOverridesViewState {
  overrides: AvailabilityOverride[];
  isAddOpen: boolean;
  deleteTarget: AvailabilityOverride | null;
  formValues: OverrideFormState;
  formError: string | null;
  isSubmitting: boolean;
  notification: { type: 'success' | 'error'; message: string } | null;
}

export type DateOverridesAction =
  | { type: 'OPEN_ADD' }
  | { type: 'CLOSE_ADD' }
  | { type: 'OPEN_DELETE'; item: AvailabilityOverride | null }
  | { type: 'CLOSE_DELETE' }
  | { type: 'UPDATE_FORM_FIELD'; name: string; value: unknown }
  | { type: 'SET_FORM_ERROR'; error: string | null }
  | { type: 'SET_SUBMITTING'; isSubmitting: boolean }
  | { type: 'CREATE_SUCCESS'; item: AvailabilityOverride; message: string }
  | { type: 'DELETE_SUCCESS'; id: string; message: string }
  | {
      type: 'SET_NOTIFICATION';
      notification: { type: 'success' | 'error'; message: string } | null;
    };

export function createInitialDateOverridesState(
  initialOverrides: AvailabilityOverride[],
  defaultAddOpen = false,
  defaultDeleteTarget: AvailabilityOverride | null = null,
  initialNotification: { type: 'success' | 'error'; message: string } | null = null,
  initialFormError: string | null = null,
  initialFormValues?: Partial<OverrideFormState>,
): DateOverridesViewState {
  return {
    overrides: initialOverrides,
    isAddOpen: defaultAddOpen,
    deleteTarget: defaultDeleteTarget,
    formValues: {
      ...getInitialOverrideFormState(),
      ...(initialFormValues ?? {}),
    },
    formError: initialFormError,
    isSubmitting: false,
    notification: initialNotification,
  };
}

export function dateOverridesReducer(
  state: DateOverridesViewState,
  action: DateOverridesAction,
): DateOverridesViewState {
  switch (action.type) {
    case 'OPEN_ADD':
      return {
        ...state,
        isAddOpen: true,
        formValues: getInitialOverrideFormState(),
        formError: null,
      };
    case 'CLOSE_ADD':
      return { ...state, isAddOpen: false, formError: null };
    case 'OPEN_DELETE':
      return { ...state, deleteTarget: action.item };
    case 'CLOSE_DELETE':
      return { ...state, deleteTarget: null };
    case 'UPDATE_FORM_FIELD':
      return {
        ...state,
        formValues: { ...state.formValues, [action.name]: action.value },
      };
    case 'SET_FORM_ERROR':
      return { ...state, formError: action.error };
    case 'SET_SUBMITTING':
      return { ...state, isSubmitting: action.isSubmitting };
    case 'CREATE_SUCCESS':
      return {
        ...state,
        overrides: filterAndSortUpcomingOverrides([
          ...state.overrides.filter((o) => o.id !== action.item.id),
          action.item,
        ]),
        isAddOpen: false,
        formValues: getInitialOverrideFormState(),
        formError: null,
        notification: { type: 'success', message: action.message },
      };
    case 'DELETE_SUCCESS':
      return {
        ...state,
        overrides: state.overrides.filter((o) => o.id !== action.id),
        deleteTarget: null,
        notification: { type: 'success', message: action.message },
      };
    case 'SET_NOTIFICATION':
      return { ...state, notification: action.notification };
    default:
      return state;
  }
}

export interface BookingTypesViewState {
  bookingTypes: BookingType[];
  isDialogOpen: boolean;
  editingItem: BookingType | null;
  deleteTarget: BookingType | null;
  formValues: BookingTypeFormState;
  formError: string | null;
  isSubmitting: boolean;
  copiedSlug: string | null;
  notification: { type: 'success' | 'error'; message: string } | null;
}

export type BookingTypesAction =
  | { type: 'OPEN_NEW' }
  | { type: 'OPEN_EDIT'; item: BookingType }
  | { type: 'CLOSE_DIALOG' }
  | { type: 'OPEN_DELETE'; item: BookingType | null }
  | { type: 'CLOSE_DELETE' }
  | { type: 'UPDATE_FORM_FIELD'; name: string; value: unknown }
  | { type: 'SET_COLOR'; color: ColorOption }
  | { type: 'SET_COPIED_SLUG'; slug: string | null }
  | { type: 'SET_FORM_ERROR'; error: string | null }
  | { type: 'SET_SUBMITTING'; isSubmitting: boolean }
  | { type: 'SAVE_SUCCESS'; item: BookingType; isEdit: boolean; message: string }
  | { type: 'DELETE_SUCCESS'; id: string; message: string }
  | {
      type: 'SET_NOTIFICATION';
      notification: { type: 'success' | 'error'; message: string } | null;
    };

export function createInitialBookingTypesState(
  initialBookingTypes: BookingType[],
  defaultDialogOpen = false,
  defaultEditingItem: BookingType | null = null,
  defaultDeleteTarget: BookingType | null = null,
  initialNotification: { type: 'success' | 'error'; message: string } | null = null,
  initialFormError: string | null = null,
  initialFormValues?: Partial<BookingTypeFormState>,
  initialCopiedSlug: string | null = null,
): BookingTypesViewState {
  return {
    bookingTypes: initialBookingTypes,
    isDialogOpen: defaultDialogOpen || Boolean(defaultEditingItem),
    editingItem: defaultEditingItem,
    deleteTarget: defaultDeleteTarget,
    formValues: {
      ...getInitialBookingTypeFormState(defaultEditingItem),
      ...(initialFormValues ?? {}),
    },
    formError: initialFormError,
    isSubmitting: false,
    copiedSlug: initialCopiedSlug,
    notification: initialNotification,
  };
}

export function bookingTypesReducer(
  state: BookingTypesViewState,
  action: BookingTypesAction,
): BookingTypesViewState {
  switch (action.type) {
    case 'OPEN_NEW':
      return {
        ...state,
        isDialogOpen: true,
        editingItem: null,
        formValues: getInitialBookingTypeFormState(null),
        formError: null,
      };
    case 'OPEN_EDIT':
      return {
        ...state,
        isDialogOpen: true,
        editingItem: action.item,
        formValues: getInitialBookingTypeFormState(action.item),
        formError: null,
      };
    case 'CLOSE_DIALOG':
      return { ...state, isDialogOpen: false, editingItem: null, formError: null };
    case 'OPEN_DELETE':
      return { ...state, deleteTarget: action.item };
    case 'CLOSE_DELETE':
      return { ...state, deleteTarget: null };
    case 'UPDATE_FORM_FIELD': {
      if (action.name === 'title') {
        const title = String(action.value);
        return {
          ...state,
          formValues: {
            ...state.formValues,
            title,
            slug: computeBookingTypeSlug(
              title,
              state.formValues.slug,
              state.formValues.slugManuallyEdited,
              Boolean(state.editingItem),
            ),
          },
        };
      }
      if (action.name === 'slug') {
        return {
          ...state,
          formValues: {
            ...state.formValues,
            slugManuallyEdited: true,
            slug: String(action.value).toLowerCase().trim(),
          },
        };
      }
      return {
        ...state,
        formValues: {
          ...state.formValues,
          [action.name]: action.value,
        },
      };
    }
    case 'SET_COLOR':
      return {
        ...state,
        formValues: {
          ...state.formValues,
          color: action.color,
        },
      };
    case 'SET_COPIED_SLUG':
      return { ...state, copiedSlug: action.slug };
    case 'SET_FORM_ERROR':
      return { ...state, formError: action.error };
    case 'SET_SUBMITTING':
      return { ...state, isSubmitting: action.isSubmitting };
    case 'SAVE_SUCCESS': {
      const updatedList = action.isEdit
        ? state.bookingTypes.map((b) => (b.id === action.item.id ? action.item : b))
        : [...state.bookingTypes, action.item];
      return {
        ...state,
        bookingTypes: updatedList,
        isDialogOpen: false,
        editingItem: null,
        formValues: getInitialBookingTypeFormState(null),
        formError: null,
        notification: { type: 'success', message: action.message },
      };
    }
    case 'DELETE_SUCCESS':
      return {
        ...state,
        bookingTypes: state.bookingTypes.filter((b) => b.id !== action.id),
        deleteTarget: null,
        notification: { type: 'success', message: action.message },
      };
    case 'SET_NOTIFICATION':
      return { ...state, notification: action.notification };
    default:
      return state;
  }
}
