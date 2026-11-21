<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { cents, formatMoney, type DocumentLanguage } from '@sim/domain';
import { api, type InvoiceListItem, type InvoicePage, type InvoiceSummary } from '../api';
import InvoiceList from '../components/InvoiceList.vue';
import { useNewInvoice } from '../composables/useNewInvoice';
import { useErrorText } from '../i18n';
import { session } from '../session';

/** FR-INV-20 start screen: counters per status (tap filters the list) and open drafts. */
const { t, locale } = useI18n();
const errorText = useErrorText();
const newInvoice = useNewInvoice();
const summary = ref<InvoiceSummary | null>(null);
const drafts = ref<InvoiceListItem[]>([]);
const error = ref('');
const money = (value: number) => formatMoney(cents(value), locale.value as DocumentLanguage);
const year = new Date().getFullYear();

const tiles = computed(() => {
  const s = summary.value;
  if (!s) return [];
  return [
    { status: 'DRAFT', label: t('dashboard.drafts'), value: s.drafts, sub: '', tone: 'muted' },
    {
      status: 'OPEN',
      label: t('dashboard.open'),
      value: s.open.count,
      sub: money(s.open.grossCents),
      tone: '',
    },
    {
      status: 'OVERDUE',
      label: t('dashboard.overdue'),
      value: s.overdue.count,
      sub: money(s.overdue.grossCents),
      tone: s.overdue.count > 0 ? 'danger' : 'muted',
    },
    {
      status: 'PAID',
      label: t('dashboard.paidThisYear', { year }),
      value: s.paidThisYear.count,
      sub: money(s.paidThisYear.grossCents),
      tone: 'ok',
    },
  ];
});

onMounted(async () => {
  try {
    [summary.value, drafts.value] = await Promise.all([
      api.get<InvoiceSummary>('invoices/summary'),
      api.get<InvoicePage>('invoices?status=DRAFT&limit=5').then((page) => page.items),
    ]);
  } catch (err) {
    error.value = errorText(err);
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
    <p v-if="error" class="alert" role="alert">{{ error }}</p>

    <nav v-if="summary" class="tiles" :aria-label="t('invoices.title')">
      <RouterLink
        v-for="tile in tiles"
        :key="tile.status"
        :to="{ name: 'invoices', query: { status: tile.status } }"
        class="tile"
        :class="tile.tone ? `tile--${tile.tone}` : ''"
        :data-testid="`tile-${tile.status}`"
      >
        <span class="tile__label">{{ tile.label }}</span>
        <span class="tile__value">{{ tile.value }}</span>
        <span v-if="tile.sub" class="tile__sub">{{ tile.sub }}</span>
      </RouterLink>
    </nav>

    <template v-if="drafts.length">
      <h2>{{ t('invoices.drafts') }}</h2>
      <InvoiceList :items="drafts" />
    </template>
  </main>
</template>
