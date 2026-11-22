<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import AiReviewNotice from '../components/AiReviewNotice.vue';
import { RouterLink, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import {
  POSITION_TYPES,
  UNIT_CODES,
  VAT_RATES,
  validateCatalogItem,
  type CatalogItemData,
} from '@sim/domain';
import { ApiError, api, type CatalogItem } from '../api';
import MoneyField from '../components/MoneyField.vue';
import TextField from '../components/TextField.vue';
import { useErrorText } from '../i18n';

/** FR-CAT-01, -02: create or edit a reusable position. */
const props = defineProps<{ id?: number }>();

const { t } = useI18n();
const errorText = useErrorText();
const router = useRouter();

type Form = {
  -readonly [K in keyof Omit<CatalogItemData, 'unitPriceCents'>]: CatalogItemData[K];
} & {
  /** null while the price field cannot be parsed. */
  unitPriceCents: number | null;
};

const form = reactive<Form>({
  type: 'WORK',
  title: '',
  description: '',
  unitCode: 'HUR',
  unitPriceCents: null,
  vatRate: 19,
  active: true,
});
const isNew = computed(() => props.id === undefined);
const item = ref<CatalogItem | null>(null);
const loading = ref(!isNew.value);
const submitted = ref(false);
const busy = ref(false);
const error = ref('');
const message = ref('');
const serverFields = ref<Record<string, string>>({});

const problems = computed(() =>
  validateCatalogItem({ ...form, unitPriceCents: form.unitPriceCents ?? Number.NaN }),
);
const fieldError = (field: keyof CatalogItemData) => {
  const code = serverFields.value[field] ?? problems.value[field];
  return submitted.value && code ? t(`errors.${code}`) : undefined;
};

onMounted(async () => {
  if (isNew.value) return;
  try {
    item.value = await api.get<CatalogItem>(`catalog/${props.id}`);
    Object.assign(form, item.value);
  } catch (err) {
    error.value = errorText(err);
  } finally {
    loading.value = false;
  }
});

async function save(): Promise<void> {
  submitted.value = true;
  error.value = message.value = '';
  serverFields.value = {};
  if (Object.keys(problems.value).length > 0) {
    error.value = t('errors.VALIDATION_FAILED');
    return;
  }
  busy.value = true;
  try {
    if (isNew.value) {
      const created = await api.post<CatalogItem>('catalog', form);
      await router.replace({ name: 'catalog-edit', params: { id: created.id } });
      return;
    }
    item.value = await api.put<CatalogItem>(`catalog/${props.id}`, form);
    submitted.value = false;
    message.value = t('catalog.saved');
  } catch (err) {
    if (err instanceof ApiError) serverFields.value = { ...err.fields };
    error.value = errorText(err);
  } finally {
    busy.value = false;
  }
}

async function remove(): Promise<void> {
  if (!item.value || !window.confirm(t('catalog.confirmDelete', { name: item.value.title })))
    return;
  try {
    await api.delete(`catalog/${props.id}`);
    await router.replace({ name: 'catalog' });
  } catch (err) {
    error.value = errorText(err);
  }
}
</script>

<template>
  <main class="page">
    <RouterLink :to="{ name: 'catalog' }" class="back-link">{{ t('common.back') }}</RouterLink>
    <h1>{{ isNew ? t('catalog.new') : t('catalog.edit') }}</h1>

    <p v-if="loading" class="hint">{{ t('common.loading') }}</p>

    <!-- FR-MCP-10: created by an AI assistant – check, then save or confirm. -->
    <AiReviewNotice
      v-if="!loading && item?.aiCreated"
      :path="`catalog/${item.id}`"
      @reviewed="item && (item.aiCreated = false)"
    />

    <form v-else-if="isNew || item" class="card" novalidate @submit.prevent="save">
      <fieldset class="choices">
        <legend>{{ t('catalog.type') }}</legend>
        <div class="segmented">
          <button
            v-for="type in POSITION_TYPES"
            :key="type"
            type="button"
            :aria-pressed="form.type === type"
            @click="form.type = type"
          >
            {{ t(`itemTypes.${type}`) }}
          </button>
        </div>
      </fieldset>

      <TextField
        id="item-title"
        v-model="form.title"
        :label="t('catalog.itemTitle')"
        :error="fieldError('title')"
        :maxlength="120"
      />
      <TextField
        id="item-description"
        v-model="form.description"
        :label="t('catalog.description')"
        multiline
        :maxlength="4000"
      />

      <div class="row">
        <div class="field">
          <label for="item-unit">{{ t('catalog.unit') }}</label>
          <select id="item-unit" v-model="form.unitCode">
            <option v-for="code in UNIT_CODES" :key="code" :value="code">
              {{ t(`unitNames.${code}`) }}
            </option>
          </select>
        </div>
        <div class="field row__narrow">
          <label for="item-vat">{{ t('catalog.vatRate') }}</label>
          <select id="item-vat" v-model.number="form.vatRate">
            <option v-for="rate in VAT_RATES" :key="rate" :value="rate">
              {{ t('company.vatRate', { rate }) }}
            </option>
          </select>
        </div>
      </div>

      <MoneyField
        id="item-price"
        v-model="form.unitPriceCents"
        :label="t('catalog.price')"
        :hint="t('catalog.priceHint')"
        :error="fieldError('unitPriceCents')"
      />

      <label class="checkbox">
        <input v-model="form.active" type="checkbox" />
        {{ t('catalog.active') }}
      </label>

      <p v-if="error" class="alert" role="alert">{{ error }}</p>
      <p v-if="message" class="notice" role="status">{{ message }}</p>
      <button type="submit" class="primary" :disabled="busy">
        {{ busy ? t('common.saving') : t('common.save') }}
      </button>
      <button v-if="item" type="button" class="danger" @click="remove">
        {{ t('catalog.delete') }}
      </button>
    </form>
    <p v-else-if="error" class="alert" role="alert">{{ error }}</p>
  </main>
</template>
