<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  VAT_RATES,
  formatIban,
  validateCompany,
  type CompanyField,
  type CompanyProfile,
} from '@sim/domain';
import { LANGUAGES, type Language } from '@sim/i18n';
import { ApiError, api } from '../api';
import TextField from '../components/TextField.vue';
import { useErrorText } from '../i18n';

/** FR-COMP-01..04: company profile (invoice header and footer), editable by every user. */
const { t, locale } = useI18n();
const errorText = useErrorText();

interface CompanyResponse {
  profile: CompanyProfile;
  readiness: { missing: string[] };
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] extends object ? Mutable<T[K]> : T[K] };

const form = reactive<Mutable<CompanyProfile>>({} as Mutable<CompanyProfile>);
const loaded = ref(false);
const missing = ref<string[]>([]);
const busy = ref(false);
const message = ref('');
const error = ref('');
const serverFields = ref<Record<string, string>>({});
const touched = reactive(new Set<string>());
const submitted = ref(false);
const textLanguage = ref<Language>((locale.value as Language) ?? 'de');

const problems = computed(() => (loaded.value ? validateCompany(form) : {}));

/** Field error shown after the field was left or the form was submitted. */
function fieldError(field: CompanyField): string | undefined {
  const code = serverFields.value[field] ?? problems.value[field];
  if (!code || !(submitted.value || touched.has(field))) return undefined;
  return t(`errors.${code}`);
}

function apply(data: CompanyResponse): void {
  Object.assign(form, structuredClone(data.profile));
  form.iban = form.iban ? formatIban(form.iban) : '';
  missing.value = data.readiness.missing;
  loaded.value = true;
}

onMounted(async () => {
  try {
    apply(await api.get<CompanyResponse>('company'));
  } catch (err) {
    error.value = errorText(err);
  }
});

async function save(): Promise<void> {
  submitted.value = true;
  message.value = error.value = '';
  serverFields.value = {};
  if (Object.keys(problems.value).length > 0) {
    error.value = t('errors.VALIDATION_FAILED');
    return;
  }
  busy.value = true;
  try {
    apply(await api.put<CompanyResponse>('company', form));
    submitted.value = false;
    touched.clear();
    message.value = t('company.saved');
  } catch (err) {
    if (err instanceof ApiError) serverFields.value = { ...err.fields };
    error.value = errorText(err);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <main class="page">
    <h1>{{ t('company.title') }}</h1>
    <p class="hint">{{ t('company.hint') }}</p>

    <p v-if="!loaded && !error" class="hint">{{ t('common.loading') }}</p>

    <section v-if="loaded" class="card" :class="missing.length ? 'card--warn' : 'card--ok'">
      <template v-if="missing.length">
        <p class="card__lead">{{ t('company.incomplete') }}</p>
        <ul class="checklist">
          <li v-for="key in missing" :key="key">{{ t(`company.missing.${key}`) }}</li>
        </ul>
      </template>
      <p v-else class="card__lead">{{ t('company.complete') }}</p>
    </section>

    <form v-if="loaded" class="stack" novalidate @submit.prevent="save">
      <section class="card">
        <h2>{{ t('company.general') }}</h2>
        <TextField id="c-name" v-model="form.name" :label="t('company.name')" :maxlength="200" />
        <TextField
          id="c-owner"
          v-model="form.ownerName"
          :label="t('company.ownerName')"
          autocomplete="name"
          :maxlength="200"
        />
      </section>

      <section class="card">
        <h2>{{ t('company.address') }}</h2>
        <TextField
          id="c-street"
          v-model="form.street"
          :label="t('company.street')"
          autocomplete="street-address"
          :maxlength="200"
        />
        <div class="row">
          <TextField
            id="c-zip"
            v-model="form.zip"
            class="row__narrow"
            :label="t('company.zip')"
            autocomplete="postal-code"
            inputmode="numeric"
            :maxlength="16"
          />
          <TextField
            id="c-city"
            v-model="form.city"
            :label="t('company.city')"
            autocomplete="address-level2"
            :maxlength="120"
          />
        </div>
        <TextField
          id="c-country"
          v-model="form.countryCode"
          :label="t('company.country')"
          :hint="t('company.countryHint')"
          :error="fieldError('countryCode')"
          :maxlength="2"
          @blur="touched.add('countryCode')"
        />
      </section>

      <section class="card">
        <h2>{{ t('company.contact') }}</h2>
        <TextField
          id="c-phone"
          v-model="form.phone"
          :label="t('company.phone')"
          type="tel"
          autocomplete="tel"
        />
        <TextField id="c-mobile" v-model="form.mobile" :label="t('company.mobile')" type="tel" />
        <TextField
          id="c-email"
          v-model="form.email"
          :label="t('company.email')"
          type="email"
          autocomplete="email"
          :error="fieldError('email')"
          @blur="touched.add('email')"
        />
        <TextField
          id="c-website"
          v-model="form.website"
          :label="t('company.website')"
          type="url"
          inputmode="url"
        />
      </section>

      <section class="card">
        <h2>{{ t('company.tax') }}</h2>
        <p class="hint">{{ t('company.taxIdHint') }}</p>
        <TextField
          id="c-taxnumber"
          v-model="form.taxNumber"
          :label="t('company.taxNumber')"
          :error="fieldError('taxNumber')"
          @blur="touched.add('taxNumber')"
        />
        <TextField
          id="c-vatid"
          v-model="form.vatId"
          :label="t('company.vatId')"
          :error="fieldError('vatId')"
          @blur="touched.add('vatId')"
        />
        <fieldset class="choices">
          <legend>{{ t('company.taxMode') }}</legend>
          <label class="choice">
            <input v-model="form.taxMode" type="radio" name="taxMode" value="REGULAR" />
            {{ t('company.taxModeRegular') }}
          </label>
          <label class="choice">
            <input v-model="form.taxMode" type="radio" name="taxMode" value="SMALL_BUSINESS_19" />
            {{ t('company.taxModeSmall') }}
          </label>
        </fieldset>
      </section>

      <section class="card">
        <h2>{{ t('company.bank') }}</h2>
        <TextField id="c-bank" v-model="form.bankName" :label="t('company.bankName')" />
        <TextField
          id="c-iban"
          v-model="form.iban"
          :label="t('company.iban')"
          :error="fieldError('iban')"
          :maxlength="42"
          @blur="(touched.add('iban'), (form.iban = form.iban ? formatIban(form.iban) : ''))"
        />
        <TextField
          id="c-bic"
          v-model="form.bic"
          :label="t('company.bic')"
          :error="fieldError('bic')"
          :maxlength="14"
          @blur="touched.add('bic')"
        />
        <TextField
          id="c-holder"
          v-model="form.accountHolder"
          :label="t('company.accountHolder')"
          :hint="t('company.emptyMeansOwner')"
        />
      </section>

      <section class="card">
        <h2>{{ t('company.defaults') }}</h2>
        <div class="field">
          <label for="c-term">{{ t('company.paymentTerm') }}</label>
          <input
            id="c-term"
            v-model.number="form.defaultPaymentTermDays"
            type="number"
            min="0"
            max="365"
            inputmode="numeric"
            :aria-invalid="fieldError('defaultPaymentTermDays') ? 'true' : undefined"
          />
          <small v-if="fieldError('defaultPaymentTermDays')" class="field__error" role="alert">
            {{ fieldError('defaultPaymentTermDays') }}
          </small>
        </div>
        <div v-if="form.taxMode === 'REGULAR'" class="field">
          <label for="c-vat">{{ t('company.defaultVat') }}</label>
          <select id="c-vat" v-model.number="form.defaultVatRate">
            <option v-for="rate in VAT_RATES" :key="rate" :value="rate">
              {{ t('company.vatRate', { rate }) }}
            </option>
          </select>
        </div>
        <TextField
          id="c-signature"
          v-model="form.signatureName"
          :label="t('company.signature')"
          :hint="t('company.emptyMeansOwner')"
        />
      </section>

      <section class="card">
        <h2>{{ t('company.texts') }}</h2>
        <div class="segmented" role="group" :aria-label="t('language.label')">
          <button
            v-for="lang in LANGUAGES"
            :key="lang"
            type="button"
            :aria-pressed="textLanguage === lang"
            @click="textLanguage = lang"
          >
            {{ t(`language.${lang}`) }}
          </button>
        </div>
        <p class="hint">{{ t('company.textsHint') }}</p>
        <TextField
          :id="`c-intro-${textLanguage}`"
          v-model="form.introTexts[textLanguage]"
          :label="t('company.intro')"
          multiline
          :maxlength="2000"
        />
        <TextField
          :id="`c-closing-${textLanguage}`"
          v-model="form.closingTexts[textLanguage]"
          :label="t('company.closing')"
          multiline
          :maxlength="2000"
        />
      </section>

      <div class="sticky-actions">
        <p v-if="error" class="alert" role="alert">{{ error }}</p>
        <p v-if="message" class="notice" role="status">{{ message }}</p>
        <button type="submit" class="primary" :disabled="busy">
          {{ busy ? t('common.saving') : t('common.save') }}
        </button>
      </div>
    </form>
    <p v-else-if="error" class="alert" role="alert">{{ error }}</p>
  </main>
</template>
