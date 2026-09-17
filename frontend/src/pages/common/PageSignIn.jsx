import { useState } from 'react'

import { Link, Navigate, useNavigate } from 'react-router'

import { Button, Divider, Grid, TextField, Typography } from '@mui/material'

import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded'

import AuthScreen from '../../components/AuthScreen'

import { useAuthStore } from '../../stores/auth'
import { signIn, homePathFor } from '../../api/auth'

function SignIn() {
  const navigate = useNavigate()
  const login = useAuthStore(state => state.login)
  const isAuthenticated = useAuthStore(state => state.isAuthenticated)
  const user = useAuthStore(state => state.user)

  const [action, setAction] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const [formData, setFormData] = useState({
    email: '',
    password: '',
  })
  const [errors, setErrors] = useState({})

  const validateField = (name, value) => {
    if (name === 'email') {
      if (
        value &&
        !/^[a-zA-Z0-9._%+-]+@(adypu\.edu\.in|newtonschool\.co)$/i.test(value)
      ) {
        return 'Please enter a valid ADYPU or Newton School email address'
      }
    }
    if (name === 'password') {
      if (value && value.length < 8) {
        return 'Password must be at least 8 characters'
      }
    }
    return ''
  }

  const handleChange = event => {
    const { name, value } = event.target
    setFormData(prev => ({ ...prev, [name]: value }))
    setErrors(prev => ({ ...prev, [name]: validateField(name, value) }))
    if (action) {
      setAction(null)
    }
  }

  const handleSubmit = async event => {
    event.preventDefault()

    const emailErr = validateField('email', formData.email)
    const passwordErr = validateField('password', formData.password)

    if (emailErr || passwordErr) {
      setErrors({
        email: emailErr,
        password: passwordErr,
      })
      return
    }

    setSubmitting(true)
    setAction(null)

    const payload = Object.fromEntries(new FormData(event.currentTarget))
    const result = await signIn(payload)

    setSubmitting(false)
    if (result.error) {
      setAction(result)
      return
    }
    login(result.user)
    navigate(homePathFor(result.user), { replace: true })
  }

  if (isAuthenticated) {
    return <Navigate to={homePathFor(user)} replace />
  }

  const emailError =
    errors.email ||
    action?.error?.email ||
    (typeof action?.error === 'string' ? action.error : '')
  const passwordError = errors.password || action?.error?.password

  return (
    <AuthScreen
      title="Sign In"
      subtitle="Sign in to your account to access the NST Entrepreneurship Portal."
    >
      <Grid size={12} sx={{ padding: 2 }}>
        <Button
          fullWidth
          variant="outlined"
          type="button"
          size="large"
          onClick={() => {
            window.location.href = '/api/auth/google'
          }}
        >
          Continue with Google
        </Button>

        <Divider sx={{ my: 2 }}>
          <Typography variant="body2" color="textSecondary">
            OR
          </Typography>
        </Divider>

        <form onSubmit={handleSubmit}>
          <TextField
            error={Boolean(emailError)}
            helperText={emailError}
            label="Email"
            type="email"
            name="email"
            value={formData.email}
            onChange={handleChange}
            fullWidth
            sx={{ mb: 2 }}
          />

          <TextField
            error={Boolean(passwordError)}
            helperText={passwordError}
            label="Password"
            type="password"
            name="password"
            value={formData.password}
            onChange={handleChange}
            fullWidth
            sx={{ mb: 2 }}
          />

          <Grid container sx={{ mt: 1, justifyContent: 'space-between' }}>
            <Grid size="auto">
              <Button variant="text" type="button" size="large" sx={{ pl: 0 }}>
                Forgot Password?
              </Button>
            </Grid>

            <Grid size="auto">
              <Button
                fullWidth
                variant="contained"
                type="submit"
                sx={{ mb: 1 }}
                size="large"
                disabled={submitting}
                endIcon={<ArrowForwardRoundedIcon />}
              >
                Sign In
              </Button>
            </Grid>
          </Grid>
        </form>
      </Grid>

      <Grid size={12} sx={{ padding: 2 }}>
        <Typography color="textSecondary" sx={{ mb: 1 }}>
          Don't have an account?{' '}
          <Link to="/signup" underline="hover">
            Sign up with email
          </Link>
        </Typography>
      </Grid>
    </AuthScreen>
  )
}

export default SignIn
