<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, type InvoiceListItem, type InvoicePage } from '../api';
import InvoiceList from '../components/InvoiceList.vue';
import { useNewInvoice } from '../composables/useNewInvoice';
import { session } from '../session';

/** Start screen – the dashboard tiles (FR-INV-20) follow in M6; for now: drafts + new invoice. */
const { t } = useI18n();
const newInvoice = useNewInvoice();
const drafts = ref<InvoiceListItem[]>([]);

onMounted(async () => {
  try {
    drafts.value = (await api.get<InvoicePage>('invoices?status=DRAFT&limit=10')).items;
  } catch {
    // The list is a convenience; errors show on the invoice page.
  }
});
</script>

<template>
  <main class="page">
    <h1>{{ t('home.welcome', { name: session.user?.displayName ?? '' }) }}</h1>
    <button
      type="button"
      class="primary"
      :disabled="newInvoice.creating.value"
      @click="newInvoice.create()"
    >
      {{ t('invoices.new') }}
    </button>
    <p v-if="newInvoice.error.value" class="alert" role="alert">{{ newInvoice.error.value }}</p>
    <template v-if="drafts.length">
      <h2>{{ t('invoices.drafts') }}</h2>
      <InvoiceList :items="drafts" />
    </template>
  </main>
</template>
