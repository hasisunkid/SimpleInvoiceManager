<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { INVOICE_STATUSES } from '@sim/domain';
import { api, type Customer, type InvoiceListItem, type InvoicePage } from '../api';
import InvoiceList from '../components/InvoiceList.vue';
import { useDebounced } from '../composables/useDebounced';
import { useNewInvoice } from '../composables/useNewInvoice';
import { useErrorText } from '../i18n';

/**
 * FR-INV-21: invoice list – status (incl. overdue), customer and date-range filters, search by
 * number or customer, sorting. Filters live in the URL so dashboard tiles can link to them and
 * the back button keeps them.
 */
const { t } = useI18n();
const errorText = useErrorText();
const route = useRoute();
const router = useRouter();
const newInvoice = useNewInvoice();

const STATUS_FILTERS = [...INVOICE_STATUSES.slice(0, 2), 'OVERDUE', ...INVOICE_STATUSES.slice(2)];
const SORTS = [
  { value: 'date:desc', label: 'invoices.sortDateDesc' },
  { value: 'date:asc', label: 'invoices.sortDateAsc' },
  { value: 'number:desc', label: 'invoices.sortNumberDesc' },
  { value: 'number:asc', label: 'invoices.sortNumberAsc' },
  { value: 'amount:desc', label: 'invoices.sortAmountDesc' },
  { value: 'amount:asc', label: 'invoices.sortAmountAsc' },
] as const;
const PAGE_SIZE = 50;

const queryText = (key: string) =>
  typeof route.query[key] === 'string' ? (route.query[key] as string) : '';

const status = ref(queryText('status'));
const search = ref(queryText('q'));
const from = ref(queryText('from'));
const to = ref(queryText('to'));
const sort = ref(queryText('sort') || 'date:desc');
const customerId = ref(queryText('customerId'));
const customerName = ref('');
const debouncedSearch = useDebounced(search);

const items = ref<InvoiceListItem[]>([]);
const total = ref(0);
const loading = ref(false);
const error = ref('');

const params = computed(() => {
  const [sortBy, order] = sort.value.split(':');
  const p: Record<string, string> = { sort: sortBy ?? 'date', order: order ?? 'desc' };
  if (status.value) p.status = status.value;
  if (debouncedSearch.value.trim()) p.q = debouncedSearch.value.trim();
  if (from.value) p.from = from.value;
  if (to.value) p.to = to.value;
  if (customerId.value) p.customerId = customerId.value;
  return p;
});
const hasFilters = computed(
  () =>
    Boolean(status.value || search.value || from.value || to.value || customerId.value) ||
    sort.value !== 'date:desc',
);

async function load(append = false): Promise<void> {
  loading.value = true;
  error.value = '';
  const query = new URLSearchParams({
    ...params.value,
    limit: String(PAGE_SIZE),
    offset: String(append ? items.value.length : 0),
  });
  try {
    const page = await api.get<InvoicePage>(`invoices?${query}`);
    items.value = append ? [...items.value, ...page.items] : page.items;
    total.value = page.total;
  } catch (err) {
    error.value = errorText(err);
  } finally {
    loading.value = false;
  }
}

/** Only the filters that are set end up in the URL (shareable, survives "back"). */
const urlQuery = computed(() => {
  const q: Record<string, string> = {};
  if (status.value) q.status = status.value;
  if (debouncedSearch.value.trim()) q.q = debouncedSearch.value.trim();
  if (from.value) q.from = from.value;
  if (to.value) q.to = to.value;
  if (customerId.value) q.customerId = customerId.value;
  if (sort.value !== 'date:desc') q.sort = sort.value;
  return q;
});

watch(
  params,
  () => {
    void router.replace({ query: urlQuery.value });
    void load();
  },
  { immediate: true, deep: true },
);

// Tapping a dashboard tile while the list is open changes only the query.
watch(
  () => route.query.status,
  (value) => {
    if (typeof value === 'string' && value !== status.value) status.value = value;
  },
);

onMounted(async () => {
  if (!customerId.value) return;
  try {
    customerName.value = (await api.get<Customer>(`customers/${customerId.value}`)).displayName;
  } catch {
    customerId.value = '';
  }
});

function clearFilters(): void {
  status.value = search.value = from.value = to.value = customerId.value = '';
  sort.value = 'date:desc';
}
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

    <div class="field">
      <label for="invoice-search" class="visually-hidden">{{ t('invoices.searchLabel') }}</label>
      <input
        id="invoice-search"
        v-model="search"
        type="search"
        :placeholder="t('invoices.searchPlaceholder')"
        autocomplete="off"
        enterkeyhint="search"
      />
    </div>

    <div class="segmented segmented--scroll" role="group" :aria-label="t('invoices.title')">
      <button type="button" :aria-pressed="status === ''" @click="status = ''">
        {{ t('invoices.all') }}
      </button>
      <button
        v-for="option in STATUS_FILTERS"
        :key="option"
        type="button"
        :aria-pressed="status === option"
        @click="status = option"
      >
        {{ option === 'OVERDUE' ? t('invoiceStatus.overdue') : t(`invoiceStatus.${option}`) }}
      </button>
    </div>

    <div v-if="customerId" class="filter-chip">
      <span>{{ t('invoices.customerFilter', { name: customerName }) }}</span>
      <button type="button" class="link-button" @click="customerId = ''">
        {{ t('invoices.clearFilters') }}
      </button>
    </div>

    <details class="card details">
      <summary>{{ t('invoices.filters') }}</summary>
      <div class="stack">
        <div class="row">
          <div class="field">
            <label for="invoice-from">{{ t('invoices.dateFrom') }}</label>
            <input id="invoice-from" v-model="from" type="date" />
          </div>
          <div class="field">
            <label for="invoice-to">{{ t('invoices.dateTo') }}</label>
            <input id="invoice-to" v-model="to" type="date" />
          </div>
        </div>
        <div class="field">
          <label for="invoice-sort">{{ t('invoices.sort') }}</label>
          <select id="invoice-sort" v-model="sort">
            <option v-for="option in SORTS" :key="option.value" :value="option.value">
              {{ t(option.label) }}
            </option>
          </select>
        </div>
        <button v-if="hasFilters" type="button" class="secondary" @click="clearFilters">
          {{ t('invoices.clearFilters') }}
        </button>
      </div>
    </details>

    <p v-if="error" class="alert" role="alert">{{ error }}</p>
    <p v-else-if="!loading && items.length === 0" class="hint">
      {{ hasFilters ? t('common.noResults') : t('invoices.empty') }}
    </p>
    <InvoiceList :items="items" :show-customer="!customerId" />
    <template v-if="items.length > 0">
      <p class="hint">{{ t('common.results', { shown: items.length, total }) }}</p>
      <button
        v-if="items.length < total"
        type="button"
        class="secondary"
        :disabled="loading"
        @click="load(true)"
      >
        {{ t('common.loadMore') }}
      </button>
    </template>
  </main>
</template>
