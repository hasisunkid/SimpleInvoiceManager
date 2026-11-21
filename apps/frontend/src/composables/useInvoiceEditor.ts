import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';
import {
  calculateInvoice,
  dueDate,
  isIsoDate,
  type InvoiceDraftData,
  type InvoicePositionData,
} from '@sim/domain';
import { ApiError, api, type Invoice } from '../api';

/** A position in the editor; `key` keeps Vue's list identity stable while reordering. */
export type EditorPosition = {
  -readonly [K in keyof InvoicePositionData]: InvoicePositionData[K];
} & {
  key: number;
};

export type EditorDraft = {
  -readonly [K in keyof Omit<InvoiceDraftData, 'positions'>]: InvoiceDraftData[K];
} & { positions: EditorPosition[] };

export type SaveState = 'idle' | 'saving' | 'saved' | 'offline' | 'conflict' | 'error';

/** Debounce for auto-save while typing (NFR-UX-02). */
export const AUTO_SAVE_DELAY_MS = 800;
const RETRY_DELAY_MS = 5000;

let keySequence = 0;
export function withKey(position: InvoicePositionData): EditorPosition {
  keySequence += 1;
  return { ...position, key: keySequence };
}

/**
 * Editor state for one invoice draft with debounced auto-save (NFR-UX-02):
 * - every change schedules a save; leaving the page or locking the phone saves immediately
 *   (keepalive request, so it survives the page being suspended);
 * - the server's version number protects against overwriting newer data from another device;
 * - server answers never overwrite what the user is typing – only version, § 14 check and
 *   totals are taken over.
 */
export function useInvoiceEditor(id: number) {
  const invoice = ref<Invoice | null>(null);
  const draft = reactive<EditorDraft>({} as EditorDraft);
  const loaded = ref(false);
  const saveState = ref<SaveState>('idle');
  const saveError = ref<unknown>(null);

  let version = 0;
  let dirty = false;
  let applying = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> | null = null;

  const readOnly = computed(() => invoice.value !== null && invoice.value.status !== 'DRAFT');

  /** Live totals with the shared domain calculation (AR-05) – no server round trip. */
  const calculation = computed(() =>
    calculateInvoice(loaded.value ? draft.positions : [], invoice.value?.taxMode ?? 'REGULAR'),
  );
  const due = computed(() =>
    loaded.value && isIsoDate(draft.invoiceDate)
      ? dueDate(draft.invoiceDate, Number(draft.paymentTermDays) || 0)
      : null,
  );

  function apply(server: Invoice): void {
    applying = true;
    invoice.value = server;
    version = server.version;
    Object.assign(draft, {
      customerId: server.customerId,
      documentLanguage: server.documentLanguage,
      invoiceDate: server.invoiceDate,
      serviceDateFrom: server.serviceDateFrom,
      serviceDateTo: server.serviceDateTo,
      paymentTermDays: server.paymentTermDays,
      siteAddress: server.siteAddress,
      subject: server.subject,
      introText: server.introText,
      closingText: server.closingText,
      positions: server.positions.map(({ lineTotalCents: _l, vatCategory: _v, ...p }) =>
        withKey(p),
      ),
    });
    loaded.value = true;
    dirty = false;
    // Let the deep watcher see this change as "loaded", not as a user edit.
    queueMicrotask(() => (applying = false));
  }

  async function load(): Promise<void> {
    apply(await api.get<Invoice>(`invoices/${id}`));
    saveState.value = 'idle';
  }

  function body() {
    return {
      version,
      customerId: draft.customerId,
      documentLanguage: draft.documentLanguage,
      invoiceDate: draft.invoiceDate,
      serviceDateFrom: draft.serviceDateFrom,
      serviceDateTo: draft.serviceDateTo,
      paymentTermDays: Number(draft.paymentTermDays),
      siteAddress: draft.siteAddress,
      subject: draft.subject,
      introText: draft.introText,
      closingText: draft.closingText,
      positions: draft.positions.map(({ key: _key, ...p }) => p),
    };
  }

  async function save({ keepalive = false } = {}): Promise<void> {
    clearTimeout(timer);
    if (inFlight) {
      await inFlight;
      if (!dirty) return;
    }
    if (!dirty || readOnly.value || saveState.value === 'conflict') return;
    // Incomplete dates are not sent – the user is still typing.
    if (![draft.invoiceDate, draft.serviceDateFrom].every(isIsoDate)) return;
    dirty = false;
    saveState.value = 'saving';
    inFlight = (async () => {
      try {
        const server = await api.put<Invoice>(`invoices/${id}`, body(), { keepalive });
        version = server.version;
        invoice.value = server;
        saveState.value = dirty ? 'saving' : 'saved';
        saveError.value = null;
      } catch (err) {
        saveError.value = err;
        if (err instanceof ApiError && err.code === 'INVOICE_CHANGED') {
          saveState.value = 'conflict';
        } else if (err instanceof ApiError && err.code === 'NETWORK') {
          dirty = true;
          saveState.value = 'offline';
          timer = setTimeout(() => void save(), RETRY_DELAY_MS);
        } else {
          dirty = true;
          saveState.value = 'error';
        }
      } finally {
        inFlight = null;
      }
    })();
    await inFlight;
    if (dirty && saveState.value === 'saving') await save();
  }

  /** Save right away (leaving the page, phone locked). */
  function flush(): Promise<void> {
    return save({ keepalive: true });
  }

  watch(
    draft,
    () => {
      if (applying || !loaded.value || readOnly.value) return;
      dirty = true;
      clearTimeout(timer);
      timer = setTimeout(() => void save(), AUTO_SAVE_DELAY_MS);
    },
    { deep: true },
  );

  const onHidden = () => {
    if (document.visibilityState === 'hidden') void flush();
  };
  document.addEventListener('visibilitychange', onHidden);
  window.addEventListener('pagehide', onHidden);
  onBeforeRouteLeave(async () => {
    await flush();
  });
  onBeforeUnmount(() => {
    document.removeEventListener('visibilitychange', onHidden);
    window.removeEventListener('pagehide', onHidden);
    void flush();
  });

  /** Version the server last confirmed – finalize must name it (FR-INV-11). */
  const currentVersion = () => version;

  return {
    invoice,
    draft,
    loaded,
    readOnly,
    saveState,
    saveError,
    calculation,
    due,
    load,
    save,
    flush,
    apply,
    currentVersion,
  };
}
