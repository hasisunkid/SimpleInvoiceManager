<script setup lang="ts">
import { RouterLink } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { cents, formatDate, formatMoney, type DocumentLanguage } from '@sim/domain';
import type { InvoiceListItem } from '../api';

/** Invoice rows (FR-INV-21): number, customer, date, gross amount, status badge. */
const props = defineProps<{ items: InvoiceListItem[]; showCustomer?: boolean }>();
const { t, locale } = useI18n();
const lang = () => locale.value as DocumentLanguage;
</script>

<template>
  <ul class="list">
    <li v-for="invoice in props.items" :key="invoice.id">
      <RouterLink
        :to="{ name: 'invoice-edit', params: { id: invoice.id } }"
        class="list__item invoice-row"
      >
        <span class="list__title">
          {{ invoice.number ?? t('invoiceStatus.DRAFT') }}
          <template v-if="props.showCustomer !== false">
            · {{ invoice.customerName || t('invoices.noCustomer') }}
          </template>
        </span>
        <span class="invoice-row__amount">{{
          formatMoney(cents(invoice.grossCents), lang())
        }}</span>
        <span class="list__sub">{{ formatDate(invoice.invoiceDate, lang()) }}</span>
        <span class="badges">
          <span class="badge" :class="`badge--${invoice.status.toLowerCase()}`">
            {{ t(`invoiceStatus.${invoice.status}`) }}
          </span>
          <span v-if="invoice.overdue" class="badge badge--danger">
            {{ t('invoiceStatus.overdue') }}
          </span>
        </span>
      </RouterLink>
    </li>
  </ul>
</template>
