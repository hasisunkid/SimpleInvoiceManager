<!-- The position object is owned by useInvoiceEditor(); it is edited in place on purpose. -->
<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  POSITION_TYPES,
  UNIT_CODES,
  VAT_RATES,
  cents,
  formatMoney,
  formatQuantity,
  lineTotalCents,
  parseQuantity,
  type DocumentLanguage,
} from '@sim/domain';
import type { EditorPosition } from '../composables/useInvoiceEditor';
import MoneyField from './MoneyField.vue';
import TextField from './TextField.vue';

/**
 * One invoice position (FR-INV-03, -05): compact summary, tap to edit. Invalid quantity or
 * price input never reaches the model, so auto-save only ever sends valid data.
 */
const props = defineProps<{
  position: EditorPosition;
  index: number;
  count: number;
  expanded: boolean;
  smallBusiness: boolean;
  readOnly: boolean;
}>();
const emit = defineEmits<{
  toggle: [];
  move: [delta: -1 | 1];
  duplicate: [];
  remove: [];
  saveTemplate: [];
}>();

const { t, locale } = useI18n();
/** Symbols, not words – no translation needed. */
const SYMBOL = { times: '×', up: '↑', down: '↓' } as const;
const lang = computed(() => locale.value as DocumentLanguage);
const money = (value: number) => formatMoney(cents(value), lang.value);

const quantityText = ref(formatQuantity(props.position.quantityMilli, lang.value));
const quantityInvalid = ref(false);
const priceInvalid = ref(false);

const lineTotal = computed(() =>
  lineTotalCents(props.position.quantityMilli, props.position.unitPriceCents),
);
const idFor = (field: string) => `pos-${props.position.key}-${field}`;

function onQuantity(event: Event): void {
  quantityText.value = (event.target as HTMLInputElement).value;
  const value = parseQuantity(quantityText.value);
  quantityInvalid.value = value === null || value <= 0;
  if (!quantityInvalid.value) props.position.quantityMilli = value!;
}

function onPrice(value: number | null): void {
  priceInvalid.value = value === null;
  if (value !== null) props.position.unitPriceCents = value;
}
</script>

<template>
  <li class="position" :class="{ 'position--open': props.expanded }">
    <button
      type="button"
      class="position__summary"
      :aria-expanded="props.expanded"
      :aria-controls="idFor('body')"
      @click="emit('toggle')"
    >
      <span class="position__no">{{ props.index + 1 }}</span>
      <span class="position__text">
        <span class="position__desc">{{
          props.position.description.split('\n')[0] || t('editor.description')
        }}</span>
        <span class="list__sub">
          {{ formatQuantity(props.position.quantityMilli, lang) }}
          {{ t(`units.${props.position.unitCode}`) }} {{ SYMBOL.times }}
          {{ money(props.position.unitPriceCents) }}
        </span>
      </span>
      <span class="position__total">{{ money(lineTotal) }}</span>
      <span class="badge" :class="{ 'badge--accent': props.position.type === 'WORK' }">
        {{ t(`itemTypes.${props.position.type}`) }}
      </span>
    </button>

    <div v-if="props.expanded && !props.readOnly" :id="idFor('body')" class="position__body stack">
      <div class="segmented" role="group" :aria-label="t('editor.type')">
        <button
          v-for="type in POSITION_TYPES"
          :key="type"
          type="button"
          :aria-pressed="props.position.type === type"
          @click="props.position.type = type"
        >
          {{ t(`itemTypes.${type}`) }}
        </button>
      </div>

      <TextField
        :id="idFor('description')"
        v-model="props.position.description"
        :label="t('editor.description')"
        multiline
        :rows="3"
        :maxlength="4000"
      />

      <div class="row">
        <div class="field row__narrow">
          <label :for="idFor('quantity')">{{ t('editor.quantity') }}</label>
          <input
            :id="idFor('quantity')"
            :value="quantityText"
            inputmode="decimal"
            autocomplete="off"
            :aria-invalid="quantityInvalid ? 'true' : undefined"
            :aria-describedby="quantityInvalid ? idFor('quantity-error') : undefined"
            @input="onQuantity"
          />
        </div>
        <div class="field">
          <label :for="idFor('unit')">{{ t('editor.unit') }}</label>
          <select :id="idFor('unit')" v-model="props.position.unitCode">
            <option v-for="code in UNIT_CODES" :key="code" :value="code">
              {{ t(`unitNames.${code}`) }}
            </option>
          </select>
        </div>
      </div>
      <small v-if="quantityInvalid" :id="idFor('quantity-error')" class="field__error" role="alert">
        {{ t('errors.INVALID_QUANTITY') }}
      </small>

      <MoneyField
        :id="idFor('price')"
        :model-value="props.position.unitPriceCents"
        :label="t('editor.unitPrice')"
        :error="priceInvalid ? t('errors.INVALID_PRICE') : undefined"
        @update:model-value="onPrice"
      />

      <div v-if="!props.smallBusiness" class="field">
        <label :for="idFor('vat')">{{ t('editor.vatRate') }}</label>
        <select :id="idFor('vat')" v-model.number="props.position.vatRate">
          <option v-for="rate in VAT_RATES" :key="rate" :value="rate">
            {{ t('company.vatRate', { rate }) }}
          </option>
        </select>
      </div>

      <div class="position__actions">
        <button
          type="button"
          class="secondary"
          :disabled="props.index === 0"
          :aria-label="t('editor.moveUp')"
          @click="emit('move', -1)"
        >
          {{ SYMBOL.up }}
        </button>
        <button
          type="button"
          class="secondary"
          :disabled="props.index === props.count - 1"
          :aria-label="t('editor.moveDown')"
          @click="emit('move', 1)"
        >
          {{ SYMBOL.down }}
        </button>
        <button type="button" class="secondary" @click="emit('duplicate')">
          {{ t('editor.duplicate') }}
        </button>
        <button type="button" class="danger" @click="emit('remove')">
          {{ t('editor.remove') }}
        </button>
      </div>
      <button type="button" class="link-button" @click="emit('saveTemplate')">
        {{ t('editor.saveAsTemplate') }}
      </button>
      <button type="button" class="primary" @click="emit('toggle')">{{ t('editor.done') }}</button>
    </div>
  </li>
</template>
