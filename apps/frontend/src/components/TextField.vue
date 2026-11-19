<script setup lang="ts">
import { computed } from 'vue';

/**
 * Labelled input with optional hint and error (NFR-UX-04: every input has a label; errors are
 * linked via aria-describedby so screen readers announce them).
 */
const props = withDefaults(
  defineProps<{
    id: string;
    label: string;
    modelValue: string;
    hint?: string;
    error?: string;
    type?: string;
    autocomplete?: string;
    inputmode?: 'text' | 'numeric' | 'tel' | 'email' | 'url' | 'decimal';
    maxlength?: number;
    multiline?: boolean;
    rows?: number;
  }>(),
  {
    hint: undefined,
    error: undefined,
    type: 'text',
    autocomplete: 'off',
    inputmode: undefined,
    maxlength: undefined,
    rows: 3,
  },
);
const emit = defineEmits<{ 'update:modelValue': [value: string]; blur: [] }>();

const describedBy = computed(
  () =>
    [props.hint ? `${props.id}-hint` : '', props.error ? `${props.id}-error` : '']
      .filter(Boolean)
      .join(' ') || undefined,
);

function onInput(event: Event): void {
  emit('update:modelValue', (event.target as HTMLInputElement | HTMLTextAreaElement).value);
}
</script>

<template>
  <div class="field">
    <label :for="props.id">{{ props.label }}</label>
    <textarea
      v-if="props.multiline"
      :id="props.id"
      :value="props.modelValue"
      :rows="props.rows"
      :maxlength="props.maxlength"
      :aria-describedby="describedBy"
      :aria-invalid="props.error ? 'true' : undefined"
      @input="onInput"
      @blur="emit('blur')"
    ></textarea>
    <input
      v-else
      :id="props.id"
      :value="props.modelValue"
      :type="props.type"
      :autocomplete="props.autocomplete"
      :inputmode="props.inputmode"
      :maxlength="props.maxlength"
      :aria-describedby="describedBy"
      :aria-invalid="props.error ? 'true' : undefined"
      @input="onInput"
      @blur="emit('blur')"
    />
    <small v-if="props.hint" :id="`${props.id}-hint`" class="hint">{{ props.hint }}</small>
    <small v-if="props.error" :id="`${props.id}-error`" class="field__error" role="alert">
      {{ props.error }}
    </small>
  </div>
</template>
