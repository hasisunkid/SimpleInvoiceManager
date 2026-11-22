<script setup lang="ts">
import { ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { useI18n } from 'vue-i18n';
import {
  POSITION_TYPES,
  cents,
  formatMoney,
  type DocumentLanguage,
  type PositionType,
} from '@sim/domain';
import { api, type CatalogItem } from '../api';
import { useDebounced } from '../composables/useDebounced';
import AiBadge from '../components/AiBadge.vue';
import { useErrorText } from '../i18n';

/** FR-CAT-01..03: catalogue of reusable work and material positions. */
const { t, locale } = useI18n();
const errorText = useErrorText();

const query = ref('');
const debounced = useDebounced(query);
const type = ref<PositionType | null>(null);
const includeInactive = ref(false);
/** FR-MCP-10 filter "Von KI erstellt". */
const aiCreated = ref(false);
const items = ref<CatalogItem[]>([]);
const loading = ref(false);
const error = ref('');

const price = (item: CatalogItem) =>
  t('catalog.perUnit', {
    price: formatMoney(cents(item.unitPriceCents), locale.value as DocumentLanguage),
    unit: t(`units.${item.unitCode}`),
  });

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  const params = new URLSearchParams({
    q: debounced.value,
    includeInactive: String(includeInactive.value),
    aiCreated: String(aiCreated.value),
    ...(type.value ? { type: type.value } : {}),
  });
  try {
    items.value = await api.get<CatalogItem[]>(`catalog?${params}`);
  } catch (err) {
    error.value = errorText(err);
  } finally {
    loading.value = false;
  }
}

watch([debounced, type, includeInactive, aiCreated], () => void load(), { immediate: true });
</script>

<template>
  <main class="page">
    <div class="page__head">
      <h1>{{ t('catalog.title') }}</h1>
      <RouterLink :to="{ name: 'catalog-new' }" class="button primary">
        {{ t('catalog.new') }}
      </RouterLink>
    </div>
    <p class="hint">{{ t('catalog.hint') }}</p>

    <div class="segmented" role="group" :aria-label="t('catalog.type')">
      <button type="button" :aria-pressed="type === null" @click="type = null">
        {{ t('catalog.all') }}
      </button>
      <button
        v-for="option in POSITION_TYPES"
        :key="option"
        type="button"
        :aria-pressed="type === option"
        @click="type = option"
      >
        {{ t(`itemTypes.${option}`) }}
      </button>
    </div>

    <div class="field">
      <label for="catalog-search" class="visually-hidden">{{ t('catalog.searchLabel') }}</label>
      <input
        id="catalog-search"
        v-model="query"
        type="search"
        :placeholder="t('catalog.searchPlaceholder')"
        autocomplete="off"
        enterkeyhint="search"
      />
    </div>
    <label class="checkbox">
      <input v-model="includeInactive" type="checkbox" />
      {{ t('catalog.showInactive') }}
    </label>
    <label class="checkbox">
      <input v-model="aiCreated" type="checkbox" />
      {{ t('ai.filter') }}
    </label>

    <p v-if="error" class="alert" role="alert">{{ error }}</p>
    <p v-else-if="!loading && items.length === 0" class="hint">
      {{ query.trim() || aiCreated ? t('common.noResults') : t('catalog.empty') }}
    </p>

    <ul class="list" :aria-busy="loading">
      <li v-for="item in items" :key="item.id">
        <RouterLink
          :to="{ name: 'catalog-edit', params: { id: item.id } }"
          class="list__item"
          :class="{ 'list__item--muted': !item.active }"
        >
          <span class="list__title">{{ item.title }}</span>
          <span class="list__sub">{{ price(item) }}</span>
          <span class="badges">
            <span class="badge" :class="{ 'badge--accent': item.type === 'WORK' }">
              {{ t(`itemTypes.${item.type}`) }}
            </span>
            <span v-if="!item.active" class="badge badge--danger">
              {{ t('catalog.inactiveBadge') }}
            </span>
            <AiBadge v-if="item.aiCreated" />
          </span>
        </RouterLink>
      </li>
    </ul>
  </main>
</template>
