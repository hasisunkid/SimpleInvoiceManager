<script setup lang="ts">
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import PasswordChangeForm from '../components/PasswordChangeForm.vue';

/** Forced password change after first login or reset (FR-AUTH-03, FR-AUTH-04). */
const { t } = useI18n();
const router = useRouter();
</script>

<template>
  <main class="page">
    <PasswordChangeForm @changed="router.replace({ name: 'home' })">
      <p class="hint">{{ t('password.forcedHint') }}</p>
    </PasswordChangeForm>
  </main>
</template>
