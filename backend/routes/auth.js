import { Router } from 'express'

import {
  signUp,
  signIn,
  signOut,
  googleAuthCallback,
  googleAuth,
  googleLink,
  completeGoogleSignup,
  getGoogleSignupOptions,
  portfolio,
  forgotPassword,
  verifyOtp,
  resetPassword,
  verifySignupOtp,
  resendSignupOtp,
} from '../controllers/user.js'
import { requireSignedIn } from '../middleware/requireAuth.js'
import { authLimiter, guessLimiter } from '../middleware/rateLimit.js'

const router = Router()

router.get('/google', googleAuth)
router.get('/google/link', requireSignedIn, googleLink)
router.get('/google/callback', googleAuthCallback)
router.post('/google/complete-signup', authLimiter, completeGoogleSignup)
router.get('/google/signup-options', getGoogleSignupOptions)

router.post('/signup', authLimiter, signUp)
router.post('/verify-signup-otp', authLimiter, guessLimiter, verifySignupOtp)
router.post('/resend-signup-otp', authLimiter, resendSignupOtp)
router.post('/signin', authLimiter, guessLimiter, signIn)
router.post('/signout', signOut)
router.post('/forgot-password', authLimiter, forgotPassword)
router.post('/verify-otp', authLimiter, guessLimiter, verifyOtp)
router.post('/reset-password', authLimiter, guessLimiter, resetPassword)

router.get('/portfolio', portfolio)

export default router
