<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { allowedActions, formatDate, type DocumentLanguage } from '@sim/domain';
import { api, type Invoice, type StatusHistoryEntry } from '../api';
import { useErrorText } from '../i18n';
import TextField from './TextField.vue';

/**
 * FR-INV-13/-14: status actions of a finalized invoice – mark paid (with payment date), undo a
 * payment, cancel with a required reason – and the history of status changes.
 */
const props = defineProps<{ invoice: Invoice; version: number }>();
const emit = defineEmits<{ changed: [invoice: Invoice]; copy: [] }>();

const { t, locale } = useI18n();
const errorText = useErrorText();
const lang = computed(() => locale.value as DocumentLanguage);

const today = new Date().toLocaleDateString('en-CA');
const paidAt = ref(today);
const reason = ref('');
const cancelOpen = ref(false);
const busy = ref(false);
const error = ref('');
const history = ref<StatusHistoryEntry[]>([]);

const actions = computed(() => allowedActions(props.invoice.status));

async function loadHistory(): Promise<void> {
  try {
    history.value = await api.get<StatusHistoryEntry[]>(`invoices/${props.invoice.id}/history`);
  } catch {
    history.value = [];
  }
}
onMounted(loadHistory);
watch(() => props.invoice.status, loadHistory);

async function run(path: string, body: Record<string, unknown>): Promise<void> {
  busy.value = true;
  error.value = '';
  try {
    const updated = await api.post<Invoice>(`invoices/${props.invoice.id}/${path}`, {
      version: props.version,
      ...body,
    });
    emit('changed', updated);
    cancelOpen.value = false;
    reason.value = '';
  } catch (err) {
    error.value = errorText(err);
  } finally {
    busy.value = false;
  }
}

function pay(): Promise<void> {
  return run('pay', { paidAt: paidAt.value });
}

async function undoPaid(): Promise<void> {
  if (window.confirm(t('lifecycle.confirmUndoPaid'))) await run('unpay', {});
}

async function cancel(): Promise<void> {
  if (!reason.value.trim()) {
    error.value = t('errors.CANCEL_REASON_REQUIRED');
    return;
  }
  // NFR-UX-03: destructive actions need confirmation.
  if (window.confirm(t('lifecycle.confirmCancel', { number: props.invoice.number ?? '' }))) {
    await run('cancel', { reason: reason.value.trim() });
  }
}

const statusText = (status: string | null) =>
  status ? t(`invoiceStatus.${status}`) : t('lifecycle.created');
const when = (iso: string) =>
  `${formatDate(iso.slice(0, 10), lang.value)} ${new Date(iso).toLocaleTimeString(locale.value, {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
</script>

<template>
  <div class="stack">
    <p v-if="props.invoice.status === 'OPEN'" class="card__lead">
      {{ t('lifecycle.dueOn', { date: formatDate(props.invoice.dueDate, lang) }) }}
    </p>
    <p v-if="props.invoice.status === 'PAID' && props.invoice.paidAt" class="notice" role="status">
      {{ t('lifecycle.paidOn', { date: formatDate(props.invoice.paidAt, lang) }) }}
    </p>
    <p v-if="props.invoice.status === 'CANCELLED'" class="alert" role="status">
      {{ t('lifecycle.cancelledReason', { reason: props.invoice.cancelReason ?? '' }) }}
    </p>
    <p v-if="error" class="alert" role="alert">{{ error }}</p>

    <form v-if="actions.includes('PAY')" class="stack" @submit.prevent="pay">
      <TextField id="paid-at" v-model="paidAt" type="date" :label="t('lifecycle.paidAt')" />
      <button type="submit" class="primary" :disabled="busy">{{ t('lifecycle.markPaid') }}</button>
    </form>

    <button
      v-if="actions.includes('UNPAY')"
      type="button"
      class="secondary"
      :disabled="busy"
      @click="undoPaid"
    >
      {{ t('lifecycle.undoPaid') }}
    </button>

    <template v-if="actions.includes('CANCEL')">
      <button v-if="!cancelOpen" type="button" class="danger" @click="cancelOpen = true">
        {{ t('lifecycle.cancel') }}
      </button>
      <form v-else class="stack" @submit.prevent="cancel">
        <p class="hint">{{ t('lifecycle.cancelHint') }}</p>
        <TextField
          id="cancel-reason"
          v-model="reason"
          :label="t('lifecycle.cancelReason')"
          multiline
          :rows="2"
          :maxlength="1000"
        />
        <button type="submit" class="danger" :disabled="busy">{{ t('lifecycle.cancel') }}</button>
        <button type="button" class="link-button" @click="cancelOpen = false">
          {{ t('common.cancel') }}
        </button>
      </form>
    </template>

    <button
      v-if="props.invoice.status === 'CANCELLED'"
      type="button"
      class="primary"
      @click="emit('copy')"
    >
      {{ t('lifecycle.correctedCopy') }}
    </button>

    <section v-if="history.length">
      <h3>{{ t('lifecycle.history') }}</h3>
      <ol class="history">
        <li v-for="(entry, index) in history" :key="index">
          <span class="hint">{{ when(entry.at) }}</span>
          <span>
            {{ entry.fromStatus ? `${statusText(entry.fromStatus)} → ` : ''
            }}{{ statusText(entry.toStatus) }}
            <template v-if="entry.userName"> · {{ entry.userName }}</template>
          </span>
          <span v-if="entry.note" class="hint">{{ entry.note }}</span>
        </li>
      </ol>
    </section>
  </div>
</template>
