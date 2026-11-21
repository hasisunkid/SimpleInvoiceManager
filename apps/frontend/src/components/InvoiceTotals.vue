<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { cents, formatMoney, type DocumentLanguage, type InvoiceTotals } from '@sim/domain';

/** FR-INV-04/06: section subtotals, VAT per rate, gross and the § 35a labour share. */
const props = defineProps<{
  totals: InvoiceTotals;
  smallBusiness: boolean;
  privateCustomer: boolean;
}>();
const { t, locale } = useI18n();
const money = (value: number) => formatMoney(cents(value), locale.value as DocumentLanguage);
const hasBothSections = computed(
  () => props.totals.sections.WORK.netCents > 0 && props.totals.sections.MATERIAL.netCents > 0,
);
</script>

<template>
  <dl class="totals">
    <template v-if="hasBothSections">
      <dt>{{ t('editor.subtotalWork') }}</dt>
      <dd>{{ money(props.totals.sections.WORK.netCents) }}</dd>
      <dt>{{ t('editor.subtotalMaterial') }}</dt>
      <dd>{{ money(props.totals.sections.MATERIAL.netCents) }}</dd>
    </template>
    <template v-if="!props.smallBusiness">
      <dt>{{ t('editor.net') }}</dt>
      <dd>{{ money(props.totals.netCents) }}</dd>
      <template v-for="group in props.totals.vatGroups" :key="group.rate">
        <dt>{{ t('editor.vat', { rate: group.rate }) }}</dt>
        <dd>{{ money(group.vatCents) }}</dd>
      </template>
    </template>
    <dt class="totals__gross">{{ t('editor.gross') }}</dt>
    <dd class="totals__gross" data-testid="gross">{{ money(props.totals.grossCents) }}</dd>
    <template v-if="props.privateCustomer && props.totals.sections.WORK.netCents > 0">
      <dt class="totals__note">{{ t('editor.labour') }}</dt>
      <dd class="totals__note">{{ money(props.totals.labourCostInclVatCents) }}</dd>
    </template>
  </dl>
  <p v-if="props.smallBusiness" class="hint">{{ t('editor.smallBusiness') }}</p>
</template>
