<script setup lang="ts">
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { cents, formatMoney, parseMoney, type DocumentLanguage } from '@sim/domain';

/**
 * Amount input in the user's number format ("45,00" / "45.00"); the model is integer cents
 * (AR-08) or null while the text cannot be parsed.
 */
const props = withDefaults(
  defineProps<{
    id: string;
    label: string;
    modelValue: number | null;
    hint?: string;
    error?: string;
  }>(),
  { hint: undefined, error: undefined },
);
const emit = defineEmits<{ 'update:modelValue': [value: number | null] }>();
const { locale } = useI18n();
/** Currency is fixed to EUR in v1 (§1.3). */
const CURRENCY = '€';

function format(value: number | null): string {
  if (value === null) return '';
  return formatMoney(cents(value), locale.value as DocumentLanguage)
    .replace(CURRENCY, '')
    .trim();
}

const text = ref(format(props.modelValue));

watch(
  () => props.modelValue,
  (value) => {
    if (parseMoney(text.value) !== value) text.value = format(value);
  },
);

function onInput(event: Event): void {
  text.value = (event.target as HTMLInputElement).value;
  emit('update:modelValue', parseMoney(text.value));
}

function onBlur(): void {
  const value = parseMoney(text.value);
  if (value !== null) text.value = format(value);
}
</script>

<template>
  <div class="field">
    <label :for="props.id">{{ props.label }}</label>
    <div class="money">
      <input
        :id="props.id"
        :value="text"
        inputmode="decimal"
        autocomplete="off"
        :aria-describedby="
          [props.hint ? `${props.id}-hint` : '', props.error ? `${props.id}-error` : '']
            .filter(Boolean)
            .join(' ') || undefined
        "
        :aria-invalid="props.error ? 'true' : undefined"
        @input="onInput"
        @blur="onBlur"
      />
      <span class="money__unit" aria-hidden="true">{{ CURRENCY }}</span>
    </div>
    <small v-if="props.hint" :id="`${props.id}-hint`" class="hint">{{ props.hint }}</small>
    <small v-if="props.error" :id="`${props.id}-error`" class="field__error" role="alert">
      {{ props.error }}
    </small>
  </div>
</template>
