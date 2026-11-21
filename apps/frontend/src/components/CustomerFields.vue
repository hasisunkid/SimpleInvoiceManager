<!--
  The `form` prop is the reactive state object owned by useCustomerForm(); this component edits
  its fields in place on purpose, so the parent keeps one source of truth
  (vue/no-mutating-props is switched off for this file in eslint.config.js).
-->
<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { CUSTOMER_TYPES, type CustomerData, type CustomerField } from '@sim/domain';
import LanguageSelect from './LanguageSelect.vue';
import TextField from './TextField.vue';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/**
 * Customer form fields (FR-CUST-01). `compact` shows only type, name and address – the quick
 * create of the invoice editor (FR-CUST-05).
 */
const props = defineProps<{
  idPrefix: string;
  form: Mutable<CustomerData>;
  errors: Partial<Record<CustomerField, string>>;
  compact?: boolean;
}>();
const emit = defineEmits<{ touch: [field: CustomerField] }>();
const { t } = useI18n();

const isBusiness = computed(() => props.form.type === 'BUSINESS');
const id = (field: string) => `${props.idPrefix}-${field}`;
</script>

<template>
  <div class="stack">
    <fieldset class="choices">
      <legend>{{ t('customers.type') }}</legend>
      <div class="segmented">
        <button
          v-for="type in CUSTOMER_TYPES"
          :key="type"
          type="button"
          :aria-pressed="props.form.type === type"
          @click="props.form.type = type"
        >
          {{ t(`customerTypes.${type}`) }}
        </button>
      </div>
    </fieldset>

    <TextField
      v-if="isBusiness"
      :id="id('company')"
      v-model="props.form.companyName"
      :label="t('customers.companyName')"
      :error="props.errors.companyName"
      autocomplete="organization"
      :maxlength="200"
      @blur="emit('touch', 'companyName')"
    />
    <TextField
      :id="id('person')"
      v-model="props.form.contactPerson"
      :label="isBusiness ? t('customers.contactPerson') : t('customers.personName')"
      :error="props.errors.contactPerson"
      autocomplete="name"
      :maxlength="200"
      @blur="emit('touch', 'contactPerson')"
    />
    <TextField
      :id="id('street')"
      v-model="props.form.street"
      :label="t('customers.street')"
      autocomplete="street-address"
      :maxlength="200"
    />
    <div class="row">
      <TextField
        :id="id('zip')"
        v-model="props.form.zip"
        class="row__narrow"
        :label="t('customers.zip')"
        autocomplete="postal-code"
        inputmode="numeric"
        :maxlength="16"
      />
      <TextField
        :id="id('city')"
        v-model="props.form.city"
        :label="t('customers.city')"
        autocomplete="address-level2"
        :maxlength="120"
      />
    </div>

    <template v-if="!props.compact">
      <TextField
        :id="id('country')"
        v-model="props.form.countryCode"
        :label="t('customers.country')"
        :hint="t('customers.countryHint')"
        :error="props.errors.countryCode"
        :maxlength="2"
        @blur="emit('touch', 'countryCode')"
      />
      <TextField
        :id="id('email')"
        v-model="props.form.email"
        :label="t('customers.email')"
        type="email"
        :error="props.errors.email"
        @blur="emit('touch', 'email')"
      />
      <TextField
        :id="id('phone')"
        v-model="props.form.phone"
        :label="t('customers.phone')"
        type="tel"
      />
      <TextField
        v-if="isBusiness"
        :id="id('vatid')"
        v-model="props.form.vatId"
        :label="t('customers.vatId')"
        :error="props.errors.vatId"
        @blur="emit('touch', 'vatId')"
      />
      <div class="field">
        <label :for="id('language')">{{ t('customers.invoiceLanguage') }}</label>
        <LanguageSelect
          :id="id('language')"
          :model-value="props.form.invoiceLanguage"
          @update:model-value="(value) => (props.form.invoiceLanguage = value ?? 'de')"
        />
      </div>
      <TextField
        :id="id('notes')"
        v-model="props.form.notes"
        :label="t('customers.notes')"
        multiline
        :maxlength="4000"
      />
    </template>
  </div>
</template>
