<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { useI18n } from 'vue-i18n';
import type { Language } from '@sim/i18n';
import { api } from '../api';
import LanguageSelect from '../components/LanguageSelect.vue';
import { useErrorText } from '../i18n';

/** FR-STYLE-01..03: logo, accent colour and live PDF preview (admin only, decision D6). */
const { t, locale } = useI18n();
const errorText = useErrorText();

const DEFAULT_COLOR = '#3A7CA5';
const MAX_BYTES = 2 * 1024 * 1024;

interface LogoInfo {
  fileId: number;
  mimeType: string;
  width: number;
  height: number;
}
interface StyleSettings {
  logoPosition: 'LEFT' | 'RIGHT';
  accentColor: string;
  logo: LogoInfo | null;
}

const saved = ref<StyleSettings | null>(null);
const logo = ref<LogoInfo | null>(null);
const logoPosition = ref<'LEFT' | 'RIGHT'>('LEFT');
const accentColor = ref(DEFAULT_COLOR);
const previewLanguage = ref<Language | null>((locale.value as Language) ?? 'de');

const uploading = ref(false);
const saving = ref(false);
const previewing = ref(false);
const previewUrl = ref<string | null>(null);
const error = ref('');
const message = ref('');
const fileInput = ref<HTMLInputElement | null>(null);

const colorValid = computed(() => /^#[0-9A-Fa-f]{6}$/.test(accentColor.value));
const dirty = computed(
  () =>
    saved.value !== null &&
    (saved.value.logoPosition !== logoPosition.value ||
      saved.value.accentColor.toUpperCase() !== accentColor.value.toUpperCase() ||
      (saved.value.logo?.fileId ?? null) !== (logo.value?.fileId ?? null)),
);

function body() {
  return {
    logoFileId: logo.value?.fileId ?? null,
    logoPosition: logoPosition.value,
    accentColor: accentColor.value,
  };
}

function apply(style: StyleSettings): void {
  saved.value = style;
  logo.value = style.logo;
  logoPosition.value = style.logoPosition;
  accentColor.value = style.accentColor;
}

onMounted(async () => {
  try {
    apply(await api.get<StyleSettings>('settings/style'));
  } catch (err) {
    error.value = errorText(err);
  }
});

onBeforeUnmount(() => {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
});

async function onFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  error.value = message.value = '';
  if (file.size > MAX_BYTES) {
    error.value = t('errors.LOGO_TOO_LARGE');
    return;
  }
  uploading.value = true;
  try {
    logo.value = await api.upload<LogoInfo>('settings/style/logo', file);
  } catch (err) {
    error.value = errorText(err);
  } finally {
    uploading.value = false;
  }
}

async function save(): Promise<void> {
  error.value = message.value = '';
  if (!colorValid.value) {
    error.value = t('errors.INVALID_COLOR');
    return;
  }
  saving.value = true;
  try {
    apply(await api.put<StyleSettings>('settings/style', body()));
    message.value = t('style.saved');
  } catch (err) {
    error.value = errorText(err);
  } finally {
    saving.value = false;
  }
}

async function preview(): Promise<void> {
  error.value = '';
  if (!colorValid.value) {
    error.value = t('errors.INVALID_COLOR');
    return;
  }
  previewing.value = true;
  try {
    const pdf = await api.postForBlob('settings/style/preview', {
      ...body(),
      language: previewLanguage.value ?? 'de',
    });
    if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
    previewUrl.value = URL.createObjectURL(pdf);
  } catch (err) {
    error.value = errorText(err);
  } finally {
    previewing.value = false;
  }
}
</script>

<template>
  <main class="page">
    <RouterLink :to="{ name: 'settings' }" class="back-link">{{ t('common.back') }}</RouterLink>
    <h1>{{ t('style.title') }}</h1>

    <p v-if="!saved && !error" class="hint">{{ t('common.loading') }}</p>

    <template v-if="saved">
      <section class="card">
        <h2>{{ t('style.logo') }}</h2>
        <p class="hint">{{ t('style.logoHint') }}</p>
        <div class="logo-box" :class="`logo-box--${logoPosition.toLowerCase()}`">
          <img
            v-if="logo"
            :src="`api/settings/style/logo/${logo.fileId}`"
            :alt="t('style.logo')"
            class="logo-box__img"
          />
          <p v-else class="hint">{{ t('style.noLogo') }}</p>
        </div>
        <input
          id="logo-file"
          ref="fileInput"
          type="file"
          accept="image/png,image/jpeg,image/svg+xml"
          class="visually-hidden"
          @change="onFile"
        />
        <label for="logo-file" class="button secondary" :aria-disabled="uploading">
          {{ uploading ? t('style.uploading') : logo ? t('style.replace') : t('style.upload') }}
        </label>
        <button v-if="logo" type="button" class="danger" @click="logo = null">
          {{ t('style.remove') }}
        </button>

        <fieldset class="choices">
          <legend>{{ t('style.position') }}</legend>
          <label class="choice">
            <input v-model="logoPosition" type="radio" name="logoPosition" value="LEFT" />
            {{ t('style.left') }}
          </label>
          <label class="choice">
            <input v-model="logoPosition" type="radio" name="logoPosition" value="RIGHT" />
            {{ t('style.right') }}
          </label>
        </fieldset>
      </section>

      <section class="card">
        <h2>{{ t('style.color') }}</h2>
        <p class="hint">{{ t('style.colorHint') }}</p>
        <div class="color-row">
          <input
            id="accent-picker"
            v-model="accentColor"
            type="color"
            class="color-row__picker"
            :aria-label="t('style.color')"
          />
          <label for="accent-text" class="visually-hidden">{{ t('style.color') }}</label>
          <input
            id="accent-text"
            v-model="accentColor"
            maxlength="7"
            spellcheck="false"
            :aria-invalid="colorValid ? undefined : 'true'"
          />
        </div>
        <button type="button" class="link-button" @click="accentColor = DEFAULT_COLOR">
          {{ t('style.resetColor') }}
        </button>
      </section>

      <section class="card">
        <h2>{{ t('style.previewTitle') }}</h2>
        <p class="hint">{{ t('style.previewHint') }}</p>
        <label for="preview-language">{{ t('style.previewLanguage') }}</label>
        <LanguageSelect id="preview-language" v-model="previewLanguage" />
        <button type="button" class="secondary" :disabled="previewing" @click="preview">
          {{ previewing ? t('style.previewing') : t('style.preview') }}
        </button>
        <template v-if="previewUrl">
          <!-- Mobile browsers often cannot show PDFs inline – the link opens the system viewer. -->
          <a :href="previewUrl" target="_blank" rel="noopener" class="button primary">
            {{ t('style.openPreview') }}
          </a>
          <iframe :src="previewUrl" class="pdf-frame" :title="t('style.previewTitle')"></iframe>
        </template>
      </section>

      <div class="sticky-actions">
        <p v-if="error" class="alert" role="alert">{{ error }}</p>
        <p v-if="message" class="notice" role="status">{{ message }}</p>
        <p v-else-if="dirty" class="hint">{{ t('style.unsaved') }}</p>
        <button type="button" class="primary" :disabled="saving" @click="save">
          {{ saving ? t('common.saving') : t('common.save') }}
        </button>
      </div>
    </template>
    <p v-else-if="error" class="alert" role="alert">{{ error }}</p>
  </main>
</template>
