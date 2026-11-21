<script setup lang="ts">
import { ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { api, type Customer, type CustomerPage } from '../api';
import { useDebounced } from '../composables/useDebounced';
import { useErrorText } from '../i18n';

/** FR-CUST-01/02: customer list with search as you type. */
const { t } = useI18n();
const errorText = useErrorText();

const PAGE_SIZE = 50;
const query = ref('');
const includeArchived = ref(false);
const debounced = useDebounced(query);
const items = ref<Customer[]>([]);
const total = ref(0);
const loading = ref(false);
const error = ref('');

async function load(append = false): Promise<void> {
  loading.value = true;
  error.value = '';
  const q = debounced.value;
  const params = new URLSearchParams({
    q,
    limit: String(PAGE_SIZE),
    offset: String(append ? items.value.length : 0),
    includeArchived: String(includeArchived.value),
  });
  try {
    const page = await api.get<CustomerPage>(`customers?${params}`);
    if (q !== debounced.value) return; // a newer search is running
    items.value = append ? [...items.value, ...page.items] : page.items;
    total.value = page.total;
  } catch (err) {
    error.value = errorText(err);
  } finally {
    loading.value = false;
  }
}

watch([debounced, includeArchived], () => void load(), { immediate: true });
</script>

<template>
  <main class="page">
    <div class="page__head">
      <h1>{{ t('customers.title') }}</h1>
      <RouterLink :to="{ name: 'customer-new' }" class="button primary">
        {{ t('customers.new') }}
      </RouterLink>
    </div>

    <div class="field">
      <label for="customer-search" class="visually-hidden">{{ t('customers.searchLabel') }}</label>
      <input
        id="customer-search"
        v-model="query"
        type="search"
        :placeholder="t('customers.searchPlaceholder')"
        autocomplete="off"
        enterkeyhint="search"
      />
    </div>
    <label class="checkbox">
      <input v-model="includeArchived" type="checkbox" />
      {{ t('customers.showArchived') }}
    </label>

    <p v-if="error" class="alert" role="alert">{{ error }}</p>
    <p v-else-if="!loading && items.length === 0" class="hint">
      {{ query.trim().length >= 2 ? t('common.noResults') : t('customers.empty') }}
    </p>

    <ul class="list" :aria-busy="loading">
      <li v-for="customer in items" :key="customer.id">
        <RouterLink
          :to="{ name: 'customer-edit', params: { id: customer.id } }"
          class="list__item"
          :class="{ 'list__item--muted': customer.archived }"
        >
          <span class="list__title">{{ customer.displayName }}</span>
          <span class="list__sub">
            {{
              [customer.street, [customer.zip, customer.city].filter(Boolean).join(' ')]
                .filter(Boolean)
                .join(', ')
            }}
          </span>
          <span class="badges">
            <span class="badge">{{ t(`customerTypes.${customer.type}`) }}</span>
            <span v-if="customer.archived" class="badge badge--danger">
              {{ t('customers.archivedBadge') }}
            </span>
          </span>
        </RouterLink>
      </li>
    </ul>

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
