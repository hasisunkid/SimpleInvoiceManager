<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { cents, formatMoney, type DocumentLanguage } from '@sim/domain';
import { api, type CatalogItem } from '../api';
import { useDebounced } from '../composables/useDebounced';
import { useErrorText } from '../i18n';

/** FR-CAT-03: pick a catalogue item for the invoice – one tap inserts it. */
const emit = defineEmits<{ pick: [item: CatalogItem]; close: [] }>();
const { t, locale } = useI18n();
const errorText = useErrorText();

const dialog = ref<HTMLDialogElement | null>(null);
const query = ref('');
const debounced = useDebounced(query, 200);
const items = ref<CatalogItem[]>([]);
const loading = ref(false);
const error = ref('');

async function load(): Promise<void> {
  loading.value = true;
  try {
    items.value = await api.get<CatalogItem[]>(`catalog?q=${encodeURIComponent(debounced.value)}`);
  } catch (err) {
    error.value = errorText(err);
  } finally {
    loading.value = false;
  }
}

watch(debounced, () => void load(), { immediate: true });
onMounted(async () => {
  // Native modal dialog: focus trap, Escape to close, background inert (NFR-UX-04).
  dialog.value?.showModal?.();
  await nextTick();
});
</script>

<template>
  <dialog
    ref="dialog"
    class="sheet"
    aria-labelledby="catalog-sheet-title"
    @close="emit('close')"
    @cancel="emit('close')"
  >
    <div class="sheet__head">
      <h2 id="catalog-sheet-title">{{ t('editor.catalogTitle') }}</h2>
      <button type="button" class="link-button" @click="emit('close')">
        {{ t('editor.close') }}
      </button>
    </div>
    <label for="catalog-sheet-search" class="visually-hidden">{{
      t('editor.catalogSearch')
    }}</label>
    <input
      id="catalog-sheet-search"
      v-model="query"
      type="search"
      :placeholder="t('editor.catalogSearch')"
      autocomplete="off"
    />
    <p v-if="error" class="alert" role="alert">{{ error }}</p>
    <p v-else-if="!loading && items.length === 0" class="hint">{{ t('common.noResults') }}</p>
    <ul class="list sheet__list" :aria-busy="loading">
      <li v-for="item in items" :key="item.id">
        <button type="button" class="list__item list__button" @click="emit('pick', item)">
          <span class="list__title">{{ item.title }}</span>
          <span class="list__sub">
            {{
              t('catalog.perUnit', {
                price: formatMoney(cents(item.unitPriceCents), locale as DocumentLanguage),
                unit: t(`units.${item.unitCode}`),
              })
            }}
          </span>
          <span class="badges">
            <span class="badge" :class="{ 'badge--accent': item.type === 'WORK' }">
              {{ t(`itemTypes.${item.type}`) }}
            </span>
          </span>
        </button>
      </li>
    </ul>
  </dialog>
</template>
