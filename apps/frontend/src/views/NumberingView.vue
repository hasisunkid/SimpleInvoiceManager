<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { YEAR_PLACEHOLDER, formatInvoiceNumber } from '@sim/domain';
import { api } from '../api';
import { useErrorText } from '../i18n';

/** FR-NUM-01..04 / US #7: start number and format of invoice numbers (admin only). */
const { t } = useI18n();
const errorText = useErrorText();

interface Numbering {
  prefix: string;
  minDigits: number;
  nextValue: number;
  resetYearly: boolean;
  configured: boolean;
  lastAssigned: string | null;
  nextNumber: string;
}

const data = ref<Numbering | null>(null);
const prefix = ref('');
const minDigits = ref(0);
const nextValue = ref(1);
const resetYearly = ref(false);
const busy = ref(false);
const error = ref('');
const message = ref('');

const year = new Date().getFullYear();
const example = computed(() =>
  Number.isInteger(nextValue.value) && nextValue.value >= 1
    ? formatInvoiceNumber(
        { prefix: prefix.value, minDigits: Number(minDigits.value) || 0 },
        nextValue.value,
        year,
      )
    : '–',
);

function apply(n: Numbering): void {
  data.value = n;
  prefix.value = n.prefix;
  minDigits.value = n.minDigits;
  nextValue.value = n.nextValue;
  resetYearly.value = n.resetYearly;
}

onMounted(async () => {
  try {
    apply(await api.get<Numbering>('settings/numbering'));
  } catch (err) {
    error.value = errorText(err);
  }
});

function insertYear(): void {
  if (!prefix.value.includes(YEAR_PLACEHOLDER))
    prefix.value = `${prefix.value}${YEAR_PLACEHOLDER}-`;
}

async function save(): Promise<void> {
  error.value = message.value = '';
  busy.value = true;
  try {
    apply(
      await api.put<Numbering>('settings/numbering', {
        prefix: prefix.value,
        minDigits: Number(minDigits.value),
        nextValue: Number(nextValue.value),
        resetYearly: resetYearly.value,
      }),
    );
    message.value = t('numbering.saved');
  } catch (err) {
    error.value = errorText(err);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <main class="page">
    <RouterLink :to="{ name: 'settings' }" class="back-link">{{ t('common.back') }}</RouterLink>
    <h1>{{ t('numbering.title') }}</h1>
    <p class="hint">{{ t('numbering.hint') }}</p>

    <p v-if="!data && !error" class="hint">{{ t('common.loading') }}</p>

    <form v-if="data" class="card" novalidate @submit.prevent="save">
      <p v-if="!data.configured" class="alert" role="status">{{ t('numbering.notConfigured') }}</p>

      <div class="field">
        <label for="n-next">{{ t('numbering.nextValue') }}</label>
        <input
          id="n-next"
          v-model.number="nextValue"
          type="number"
          min="1"
          inputmode="numeric"
          aria-describedby="n-next-hint"
        />
        <small id="n-next-hint" class="hint">{{ t('numbering.nextValueHint') }}</small>
        <small v-if="data.lastAssigned" class="hint">
          {{ t('numbering.lastAssigned', { number: data.lastAssigned }) }}
        </small>
      </div>

      <div class="field">
        <label for="n-prefix">{{ t('numbering.prefix') }}</label>
        <input
          id="n-prefix"
          v-model="prefix"
          maxlength="20"
          spellcheck="false"
          autocapitalize="characters"
          aria-describedby="n-prefix-hint"
        />
        <small id="n-prefix-hint" class="hint">
          {{ t('numbering.prefixHint', { year: YEAR_PLACEHOLDER }) }}
        </small>
        <button type="button" class="link-button" @click="insertYear">
          {{ YEAR_PLACEHOLDER }}
        </button>
      </div>

      <div class="field">
        <label for="n-digits">{{ t('numbering.minDigits') }}</label>
        <input
          id="n-digits"
          v-model.number="minDigits"
          type="number"
          min="0"
          max="8"
          inputmode="numeric"
          aria-describedby="n-digits-hint"
        />
        <small id="n-digits-hint" class="hint">{{ t('numbering.minDigitsHint') }}</small>
      </div>

      <label class="checkbox">
        <input v-model="resetYearly" type="checkbox" />
        {{ t('numbering.resetYearly') }}
      </label>

      <div class="example" aria-live="polite">
        <span class="hint">{{ t('numbering.example') }}</span>
        <strong class="example__value">{{ example }}</strong>
      </div>

      <p v-if="error" class="alert" role="alert">{{ error }}</p>
      <p v-if="message" class="notice" role="status">{{ message }}</p>
      <button type="submit" class="primary" :disabled="busy">
        {{ busy ? t('common.saving') : t('common.save') }}
      </button>
    </form>
    <p v-else-if="error" class="alert" role="alert">{{ error }}</p>
  </main>
</template>
