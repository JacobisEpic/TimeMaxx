import { RELEASE_METADATA } from '@/src/constants/releaseMetadata';

export type LegalDocumentKey = 'privacy' | 'terms' | 'support';

export type LegalDocument = {
  key: LegalDocumentKey;
  title: string;
  summary: string;
  publicUrl: string;
  sections: string[];
};

export const APP_WEBSITE_URL = RELEASE_METADATA.publicUrls.website;
export const SUPPORT_EMAIL = RELEASE_METADATA.supportEmail;

export const LEGAL_DOCUMENTS: LegalDocument[] = [
  {
    key: 'privacy',
    title: 'Privacy Policy',
    summary: 'How data is stored, used, and deleted.',
    publicUrl: RELEASE_METADATA.publicUrls.privacy,
    sections: [
      'TimeMaxx does not require an account and does not operate a backend service for your timeline data.',
      'We do not collect, store, or share any personal data.',
      'All data remains on-device unless explicitly exported by the user.',
      'Your time blocks and settings are stored locally on your device.',
      'If you choose to share a summary, the exported text is generated on-device and shared only through the destination you pick.',
      'You can delete your data at any time from Settings by using "Reset all data."',
      'For privacy questions, use the Support & FAQ section in Settings.',
    ],
  },
  {
    key: 'terms',
    title: 'Terms of Service',
    summary: 'Basic usage terms and limitations.',
    publicUrl: RELEASE_METADATA.publicUrls.terms,
    sections: [
      'TimeMaxx is provided as-is for personal productivity tracking.',
      'You are responsible for your own use of the app and any decisions made from its data.',
      'You may not attempt to reverse engineer, abuse, or interfere with normal app operation.',
      'The app may change over time, including features and availability.',
      'For support requests, use the Support & FAQ section in Settings.',
    ],
  },
  {
    key: 'support',
    title: 'Support & FAQ',
    summary: 'Where to get help and report issues.',
    publicUrl: RELEASE_METADATA.publicUrls.support,
    sections: [
      'Need help? Use the email support action below.',
      'Please include your app version, device model, iOS version, and steps to reproduce.',
      'The most common fix for data issues is to force-close and reopen the app.',
      'If issues continue, include screenshots and exact times shown in the timeline.',
    ],
  },
];
