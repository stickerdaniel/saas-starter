import Resend from '@auth/core/providers/resend';
import { Resend as ResendAPI } from 'resend';
import type { RandomReader } from '@oslojs/crypto/random';
import { generateRandomString } from '@oslojs/crypto/random';

export const ResendOTP = Resend({
	id: 'resend-otp',
	apiKey: process.env.AUTH_RESEND_KEY,
	async generateVerificationToken() {
		const random: RandomReader = {
			read(bytes) {
				crypto.getRandomValues(bytes);
			}
		};

		const alphabet = '0123456789';
		const length = 8;
		return generateRandomString(random, alphabet, length);
	},
	async sendVerificationRequest({ identifier: email, provider, token }) {
		const resend = new ResendAPI(provider.apiKey);
		const { error } = await resend.emails.send({
			from: process.env.AUTH_EMAIL || 'noreply@example.com',
			to: [email],
			subject: `Verify your email`,
			text: `Your verification code is: ${token}

This code will expire in 20 minutes.

If you didn't request this code, please ignore this email.`
		});

		if (error) {
			throw new Error('Could not send verification email');
		}
	}
});
