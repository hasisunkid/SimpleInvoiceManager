<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { LUMP_SUM_UNIT, formatDate, type CompanyProfile, type DocumentLanguage } from '@sim/domain';
import type { Language } from '@sim/i18n';
import { api, type CatalogItem, type Customer, type Invoice } from '../api';
import CatalogSheet from '../components/CatalogSheet.vue';
import CustomerPicker from '../components/CustomerPicker.vue';
import InvoiceTotals from '../components/InvoiceTotals.vue';
import LanguageSelect from '../components/LanguageSelect.vue';
import PositionCard from '../components/PositionCard.vue';
import TextField from '../components/TextField.vue';
import { useInvoiceEditor, withKey } from '../composables/useInvoiceEditor';
import { useErrorText } from '../i18n';

/** FR-INV-01..08: the invoice editor (mobile-first, auto-saved). */
const props = defineProps<{ id: number }>();

const { t, locale } = useI18n();
const errorText = useErrorText();
const router = useRouter();
const editor = useInvoiceEditor(props.id);
const { invoice, draft, loaded, readOnly, saveState, saveError, calculation, due } = editor;

const company = ref<CompanyProfile | null>(null);
const customer = ref<Customer | null>(null);
const expandedKey = ref<number | null>(null);
const catalogOpen = ref(false);
const message = ref('');
const error = ref('');
const dragIndex = ref<number | null>(null);

const smallBusiness = computed(() => invoice.value?.taxMode === 'SMALL_BUSINESS_19');
const uiLang = computed(() => locale.value as DocumentLanguage);
const title = computed(() =>
  invoice.value?.number
    ? t('editor.titleFinal', { number: invoice.value.number })
    : t('editor.titleDraft'),
);
const servicePeriod = computed({
  get: () => draft.serviceDateTo !== null,
  set: (on: boolean) => (draft.serviceDateTo = on ? draft.serviceDateFrom : null),
});

onMounted(async () => {
  try {
    await editor.load();
    customer.value = invoice.value?.customer ?? null;
    company.value = (await api.get<{ profile: CompanyProfile }>('company')).profile;
  } catch (err) {
    error.value = errorText(err);
  }
});

/**
 * FR-I18N-02: switching the document language also switches intro/closing texts – but only
 * if they are still the company defaults (never overwrite what the user wrote).
 */
function setLanguage(language: Language): void {
  const old = draft.documentLanguage;
  if (company.value && old !== language) {
    if (!draft.introText.trim() || draft.introText === company.value.introTexts[old]) {
      draft.introText = company.value.introTexts[language];
    }
    if (!draft.closingText.trim() || draft.closingText === company.value.closingTexts[old]) {
      draft.closingText = company.value.closingTexts[language];
    }
  }
  draft.documentLanguage = language;
}

function chooseCustomer(selected: Customer | null): void {
  customer.value = selected;
  draft.customerId = selected?.id ?? null;
  if (selected) setLanguage(selected.invoiceLanguage);
}

/** FR-INV-03: a lump-sum position is the default (1 × pauschal), as in the reference invoices. */
function addFree(): void {
  const position = withKey({
    type: 'WORK',
    description: '',
    quantityMilli: 1000,
    unitCode: LUMP_SUM_UNIT,
    unitPriceCents: 0,
    vatRate: company.value?.defaultVatRate ?? 19,
  });
  draft.positions.push(position);
  expandedKey.value = position.key;
}

/** FR-CAT-03: values are copied – later catalogue edits do not change this invoice. */
function addFromCatalog(item: CatalogItem): void {
  draft.positions.push(
    withKey({
      type: item.type,
      description: item.description ? `${item.title}\n${item.description}` : item.title,
      quantityMilli: 1000,
      unitCode: item.unitCode,
      unitPriceCents: item.unitPriceCents,
      vatRate: item.vatRate,
    }),
  );
  catalogOpen.value = false;
}

function move(index: number, delta: -1 | 1): void {
  const target = index + delta;
  if (target < 0 || target >= draft.positions.length) return;
  const [moved] = draft.positions.splice(index, 1);
  draft.positions.splice(target, 0, moved!);
}

function duplicate(index: number): void {
  const { key: _key, ...copy } = draft.positions[index]!;
  draft.positions.splice(index + 1, 0, withKey(copy));
}

function remove(index: number): void {
  if (!window.confirm(t('editor.confirmRemove'))) return;
  draft.positions.splice(index, 1);
}

/** FR-CAT-04: "Save as template" – first line becomes the title, the rest the description. */
async function saveAsTemplate(index: number): Promise<void> {
  const p = draft.positions[index]!;
  const [first = '', ...rest] = p.description.split('\n');
  message.value = error.value = '';
  try {
    await api.post('catalog', {
      type: p.type,
      title: (first.trim() || t(`itemTypes.${p.type}`)).slice(0, 120),
      description: rest.join('\n').trim(),
      unitCode: p.unitCode,
      unitPriceCents: p.unitPriceCents,
      vatRate: p.vatRate,
      active: true,
    });
    message.value = t('editor.templateSaved');
  } catch (err) {
    error.value = errorText(err);
  }
}

// Desktop drag & drop (FR-INV-05); phones use the up/down buttons.
function onDrop(index: number): void {
  if (dragIndex.value === null || dragIndex.value === index) return;
  const [moved] = draft.positions.splice(dragIndex.value, 1);
  draft.positions.splice(index, 0, moved!);
  dragIndex.value = null;
}

async function copyInvoice(): Promise<void> {
  try {
    await editor.flush();
    const copy = await api.post<Invoice>(`invoices/${props.id}/copy`);
    await router.push({ name: 'invoice-edit', params: { id: copy.id } });
  } catch (err) {
    error.value = errorText(err);
  }
}

async function deleteDraft(): Promise<void> {
  if (!window.confirm(t('editor.confirmDelete'))) return;
  try {
    await api.delete(`invoices/${props.id}`);
    await router.replace({ name: 'invoices' });
  } catch (err) {
    error.value = errorText(err);
  }
}

async function reload(): Promise<void> {
  await editor.load();
  customer.value = invoice.value?.customer ?? null;
}
</script>

<template>
  <main class="page editor">
    <RouterLink :to="{ name: 'invoices' }" class="back-link">{{ t('common.back') }}</RouterLink>
    <div class="page__head">
      <h1>{{ title }}</h1>
      <span
        v-if="loaded && !readOnly"
        class="save-state"
        :class="`save-state--${saveState}`"
        role="status"
        aria-live="polite"
      >
        <template v-if="saveState === 'saving'">{{ t('editor.saving') }}</template>
        <template v-else-if="saveState === 'saved'">{{ t('editor.saved') }}</template>
        <template v-else-if="saveState === 'offline'">{{ t('editor.offline') }}</template>
      </span>
    </div>

    <p v-if="!loaded && !error" class="hint">{{ t('common.loading') }}</p>
    <p v-if="error" class="alert" role="alert">{{ error }}</p>

    <template v-if="loaded && invoice">
      <div v-if="saveState === 'conflict'" class="alert" role="alert">
        {{ t('editor.conflict') }}
        <button type="button" class="secondary" @click="reload">{{ t('editor.reload') }}</button>
      </div>
      <p v-else-if="saveState === 'error'" class="alert" role="alert">{{ errorText(saveError) }}</p>
      <p v-if="readOnly" class="notice" role="status">{{ t('editor.readOnly') }}</p>
      <p v-if="message" class="notice" role="status">{{ message }}</p>

      <section class="card">
        <h2>{{ t('editor.customer') }}</h2>
        <CustomerPicker
          v-if="!readOnly"
          :model-value="customer"
          @update:model-value="chooseCustomer"
        />
        <p v-else>{{ customer?.displayName }}</p>
      </section>

      <section class="card">
        <h2>{{ t('editor.positions') }}</h2>
        <p v-if="draft.positions.length === 0" class="hint">{{ t('editor.noPositions') }}</p>
        <ul class="positions">
          <PositionCard
            v-for="(position, index) in draft.positions"
            :key="position.key"
            :position="position"
            :index="index"
            :count="draft.positions.length"
            :expanded="expandedKey === position.key"
            :small-business="smallBusiness"
            :read-only="readOnly"
            :draggable="!readOnly"
            :title="readOnly ? undefined : t('editor.dragHint')"
            @dragstart="dragIndex = index"
            @dragover.prevent
            @drop.prevent="onDrop(index)"
            @toggle="expandedKey = expandedKey === position.key ? null : position.key"
            @move="(delta: -1 | 1) => move(index, delta)"
            @duplicate="duplicate(index)"
            @remove="remove(index)"
            @save-template="saveAsTemplate(index)"
          />
        </ul>
        <div v-if="!readOnly" class="row">
          <button type="button" class="primary" @click="catalogOpen = true">
            {{ t('editor.addFromCatalog') }}
          </button>
          <button type="button" class="secondary" @click="addFree">
            {{ t('editor.addFree') }}
          </button>
        </div>
      </section>

      <section class="card">
        <InvoiceTotals
          :totals="calculation.totals"
          :small-business="smallBusiness"
          :private-customer="customer?.type === 'PRIVATE'"
        />
      </section>

      <details class="card details">
        <summary>{{ t('editor.details') }}</summary>
        <fieldset class="stack plain-fieldset" :disabled="readOnly">
          <div class="row">
            <TextField
              id="inv-date"
              v-model="draft.invoiceDate"
              type="date"
              :label="t('editor.invoiceDate')"
            />
            <TextField
              id="inv-term"
              :model-value="String(draft.paymentTermDays)"
              type="number"
              inputmode="numeric"
              class="row__narrow"
              :label="t('editor.paymentTerm')"
              @update:model-value="
                (v: string) => (draft.paymentTermDays = Math.max(0, Math.min(365, Number(v) || 0)))
              "
            />
          </div>
          <p v-if="due" class="hint">
            {{ t('editor.dueDate', { date: formatDate(due, uiLang) }) }}
          </p>

          <div class="row">
            <TextField
              id="inv-service-from"
              v-model="draft.serviceDateFrom"
              type="date"
              :label="t('editor.serviceDate')"
            />
            <TextField
              v-if="servicePeriod"
              id="inv-service-to"
              :model-value="draft.serviceDateTo ?? ''"
              type="date"
              :label="t('editor.serviceDateTo')"
              @update:model-value="(v: string) => (draft.serviceDateTo = v)"
            />
          </div>
          <label class="checkbox">
            <input v-model="servicePeriod" type="checkbox" :disabled="readOnly" />
            {{ t('editor.servicePeriodToggle') }}
          </label>

          <div class="field">
            <label for="inv-language">{{ t('editor.language') }}</label>
            <LanguageSelect
              id="inv-language"
              :model-value="draft.documentLanguage"
              @update:model-value="(v) => v && setLanguage(v)"
            />
          </div>
          <TextField
            id="inv-subject"
            v-model="draft.subject"
            :label="t('editor.subject')"
            multiline
            :maxlength="2000"
          />
          <TextField
            id="inv-site"
            v-model="draft.siteAddress"
            :label="t('editor.siteAddress')"
            multiline
            :rows="2"
            :maxlength="2000"
          />
          <TextField
            id="inv-intro"
            v-model="draft.introText"
            :label="t('editor.intro')"
            multiline
            :maxlength="4000"
          />
          <TextField
            id="inv-closing"
            v-model="draft.closingText"
            :label="t('editor.closing')"
            multiline
            :maxlength="4000"
          />
        </fieldset>
      </details>

      <section
        v-if="!readOnly"
        class="card"
        :class="invoice.finalizeProblems.length ? 'card--warn' : 'card--ok'"
      >
        <template v-if="invoice.finalizeProblems.length">
          <p class="card__lead">{{ t('editor.notReady') }}</p>
          <ul class="checklist">
            <li v-for="problem in invoice.finalizeProblems" :key="problem">
              {{ t(`finalizeProblems.${problem}`) }}
            </li>
          </ul>
        </template>
        <p v-else class="card__lead">{{ t('editor.ready') }}</p>
      </section>

      <section class="card">
        <button type="button" class="secondary" @click="copyInvoice">{{ t('editor.copy') }}</button>
        <button v-if="!readOnly" type="button" class="danger" @click="deleteDraft">
          {{ t('editor.deleteDraft') }}
        </button>
      </section>

      <CatalogSheet v-if="catalogOpen" @pick="addFromCatalog" @close="catalogOpen = false" />
    </template>
  </main>
</template>
