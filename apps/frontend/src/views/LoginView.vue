<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import type { Language } from '@sim/i18n';
import { api, type Health } from '../api';
import LanguageSelect from '../components/LanguageSelect.vue';
import { applyLanguage, applyUserLanguage, useErrorText } from '../i18n';
import { login } from '../session';

const { t, locale } = useI18n();
const errorText = useErrorText();
const route = useRoute();
const router = useRouter();

const username = ref('');
const password = ref('');
const stayLoggedIn = ref(true);
const busy = ref(false);
const error = ref('');
const serverUnreachable = ref(false);

function changeLanguage(language: Language | null): void {
  if (language) applyLanguage(locale, language);
}

async function submit(): Promise<void> {
  if (!username.value || !password.value) return;
  busy.value = true;
  error.value = '';
  try {
    const user = await login(username.value, password.value, stayLoggedIn.value);
    applyUserLanguage(locale, user.uiLanguage);
    password.value = '';
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/';
    await router.replace(redirect.startsWith('/') ? redirect : '/');
  } catch (err) {
    error.value = errorText(err);
  } finally {
    busy.value = false;
  }
}

onMounted(async () => {
  try {
    const health = await api.get<Health>('health');
    serverUnreachable.value = health.status !== 'ok';
  } catch {
    serverUnreachable.value = true;
  }
});
</script>

<template>
  <main class="login">
    <header class="login__brand">
      <span class="login__accent" aria-hidden="true"></span>
      <h1>{{ t('app.name') }}</h1>
    </header>

    <form class="card" novalidate @submit.prevent="submit">
      <h2>{{ t('login.title') }}</h2>

      <p v-if="serverUnreachable" class="alert" role="alert">
        {{ t('status.serverUnreachable') }}
      </p>
      <p v-if="error" class="alert" role="alert">{{ error }}</p>

      <label for="username">{{ t('login.username') }}</label>
      <input
        id="username"
        v-model="username"
        name="username"
        autocomplete="username"
        autocapitalize="none"
        spellcheck="false"
        required
      />

      <label for="password">{{ t('login.password') }}</label>
      <input
        id="password"
        v-model="password"
        name="password"
        type="password"
        autocomplete="current-password"
        required
      />

      <label class="checkbox">
        <input v-model="stayLoggedIn" type="checkbox" name="stayLoggedIn" />
        {{ t('login.stayLoggedIn') }}
      </label>

      <button type="submit" class="primary" :disabled="busy">
        {{ busy ? t('login.submitting') : t('login.submit') }}
      </button>
    </form>

    <footer class="login__footer">
      <label for="language">{{ t('language.label') }}</label>
      <LanguageSelect
        id="language"
        :model-value="locale as Language"
        @update:model-value="changeLanguage"
      />
    </footer>
  </main>
</template>
