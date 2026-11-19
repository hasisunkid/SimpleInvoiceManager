<script setup lang="ts">
import { LANGUAGES, type Language } from '@sim/i18n';
import { useI18n } from 'vue-i18n';

/** Language picker; with `allowBrowser`, an empty value means "follow the browser". */
const props = defineProps<{ id: string; modelValue: Language | null; allowBrowser?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: Language | null] }>();

const { t } = useI18n();

function onChange(event: Event): void {
  const value = (event.target as HTMLSelectElement).value;
  emit('update:modelValue', value === '' ? null : (value as Language));
}
</script>

<template>
  <select :id="props.id" :value="props.modelValue ?? ''" @change="onChange">
    <option v-if="props.allowBrowser" value="">{{ t('language.browser') }}</option>
    <option v-for="lang in LANGUAGES" :key="lang" :value="lang">
      {{ t(`language.${lang}`) }}
    </option>
  </select>
</template>
