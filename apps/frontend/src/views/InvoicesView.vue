<script setup lang="ts">
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { INVOICE_STATUSES, type InvoiceStatus } from '@sim/domain';
import { api, type InvoiceListItem, type InvoicePage } from '../api';
import InvoiceList from '../components/InvoiceList.vue';
import { useNewInvoice } from '../composables/useNewInvoice';
import { useErrorText } from '../i18n';

/** Invoice list (basic; search, date filters and sorting follow in M6 – FR-INV-21). */
const { t } = useI18n();
const errorText = useErrorText();
const newInvoice = useNewInvoice();

const PAGE_SIZE = 50;
const status = ref<InvoiceStatus | null>(null);
const items = ref<InvoiceListItem[]>([]);
const total = ref(0);
const loading = ref(false);
const error = ref('');

async function load(append = false): Promise<void> {
  loading.value = true;
  error.value = '';
  const params = new URLSearchParams({
    limit: String(PAGE_SIZE),
    offset: String(append ? items.value.length : 0),
    ...(status.value ? { status: status.value } : {}),
  });
  try {
    const page = await api.get<InvoicePage>(`invoices?${params}`);
    items.value = append ? [...items.value, ...page.items] : page.items;
    total.value = page.total;
  } catch (err) {
    error.value = errorText(err);
  } finally {
    loading.value = false;
  }
}

watch(status, () => void load(), { immediate: true });
</script>

<template>
  <main class="page">
    <div class="page__head">
      <h1>{{ t('invoices.title') }}</h1>
      <button
        type="button"
        class="primary page__head-action"
        :disabled="newInvoice.creating.value"
        @click="newInvoice.create()"
      >
        {{ t('invoices.new') }}
      </button>
    </div>
    <p v-if="newInvoice.error.value" class="alert" role="alert">{{ newInvoice.error.value }}</p>

    <div class="segmented segmented--scroll" role="group" :aria-label="t('invoices.title')">
      <button type="button" :aria-pressed="status === null" @click="status = null">
        {{ t('invoices.all') }}
      </button>
      <button
        v-for="option in INVOICE_STATUSES"
        :key="option"
        type="button"
        :aria-pressed="status === option"
        @click="status = option"
      >
        {{ t(`invoiceStatus.${option}`) }}
      </button>
    </div>

    <p v-if="error" class="alert" role="alert">{{ error }}</p>
    <p v-else-if="!loading && items.length === 0" class="hint">{{ t('invoices.empty') }}</p>
    <InvoiceList :items="items" />
    <button
      v-if="items.length < total"
      type="button"
      class="secondary"
      :disabled="loading"
      @click="load(true)"
    >
      {{ t('common.loadMore') }}
    </button>
  </main>
</template>
