import { useEffect, useState } from 'react'

import { Link, Navigate, useNavigate } from 'react-router'

import {
  Button,
  Divider,
  FormControl,
  FormHelperText,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
} from '@mui/material'

import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded'

import AuthScreen from '../../components/AuthScreen'

import { useAuthStore } from '../../stores/auth'
import { signUp, homePathFor } from '../../api/auth'

function SignUp() {
  const navigate = useNavigate()
  const login = useAuthStore(state => state.login)
  const isAuthenticated = useAuthStore(state => state.isAuthenticated)
  const user = useAuthStore(state => state.user)

  const [action, setAction] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
    campus: '',
    batch: '',
  })
  const [errors, setErrors] = useState({})

  const [options, setOptions] = useState({
    campuses: [],
    batches: [],
  })

  const [loadingOptions, setLoadingOptions] = useState(true)

  useEffect(() => {
    const loadOptions = async () => {
      try {
        const response = await fetch('/api/auth/google/signup-options')

        const data = await response.json()

        if (!response.ok) {
          throw new Error(data.error || 'Failed to load signup options')
        }

        setOptions({
          campuses: data.campuses || [],
          batches: data.batches || [],
        })
      } catch (error) {
        console.error('Failed to load signup options:', error)
      } finally {
        setLoadingOptions(false)
      }
    }

    loadOptions()
  }, [])

  const validateField = (name, value) => {
    if (name === 'username') {
      if (/[^a-zA-Z\s]/.test(value)) {
        return 'Name must contain only letters and spaces'
      }
    }
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
      setAction(prev =>
        prev
          ? {
              ...prev,
              error: { ...prev.error, [name]: '' },
            }
          : null
      )
    }
  }

  const handleSubmit = async event => {
    event.preventDefault()

    const usernameErr = validateField('username', formData.username)
    const emailErr = validateField('email', formData.email)
    const passwordErr = validateField('password', formData.password)

    if (usernameErr || emailErr || passwordErr) {
      setErrors({
        username: usernameErr,
        email: emailErr,
        password: passwordErr,
      })
      return
    }

    setSubmitting(true)
    setAction(null)

    const payload = Object.fromEntries(new FormData(event.currentTarget))
    const result = await signUp(payload)

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

  const nameError = errors.username || action?.error?.username
  const emailError = errors.email || action?.error?.email
  const passwordError = errors.password || action?.error?.password

  return (
    <AuthScreen
      title="Sign Up"
      subtitle="Create an account to access the NST Entrepreneurship Portal."
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
            fullWidth
            error={Boolean(nameError)}
            label="Name"
            name="username"
            type="text"
            value={formData.username}
            onChange={handleChange}
            helperText={nameError}
            sx={{ mb: 2 }}
          />

          <TextField
            fullWidth
            error={Boolean(emailError)}
            label="Email"
            name="email"
            type="email"
            value={formData.email}
            onChange={handleChange}
            helperText={emailError}
            sx={{ mb: 2 }}
          />

          <TextField
            fullWidth
            error={Boolean(passwordError)}
            label="Password"
            name="password"
            type="password"
            value={formData.password}
            onChange={handleChange}
            helperText={passwordError}
            sx={{ mb: 2 }}
          />

          <FormControl fullWidth sx={{ mb: 2 }} disabled={loadingOptions}>
            <InputLabel>Campus</InputLabel>

            <Select
              label="Campus"
              name="campus"
              value={formData.campus}
              onChange={handleChange}
              error={Boolean(action && action.error?.campus)}
            >
              {options.campuses.map(campus => (
                <MenuItem key={campus._id} value={campus._id}>
                  {campus.name}
                </MenuItem>
              ))}
            </Select>

            {action && action.error?.campus && (
              <FormHelperText error>{action.error.campus}</FormHelperText>
            )}
          </FormControl>

          <FormControl fullWidth sx={{ mb: 2 }} disabled={loadingOptions}>
            <InputLabel>Batch</InputLabel>

            <Select
              label="Batch"
              name="batch"
              value={formData.batch}
              onChange={handleChange}
              error={Boolean(action && action.error?.batch)}
            >
              {options.batches.map(batch => (
                <MenuItem key={batch._id} value={batch._id}>
                  {batch.name}
                </MenuItem>
              ))}
            </Select>

            {action && action.error?.batch && (
              <FormHelperText error>{action.error.batch}</FormHelperText>
            )}
          </FormControl>

          <Grid container sx={{ mt: 1, justifyContent: 'flex-end' }}>
            <Grid size="auto">
              <Button
                fullWidth
                variant="contained"
                type="submit"
                sx={{ mb: 1 }}
                size="large"
                disabled={loadingOptions || submitting}
                endIcon={<ArrowForwardRoundedIcon />}
              >
                Sign Up
              </Button>
            </Grid>
          </Grid>
        </form>
      </Grid>

      <Grid size={12} sx={{ padding: 2 }}>
        <Typography color="textSecondary" sx={{ mb: 1 }}>
          Already have an account?{' '}
          <Link to="/signin" underline="hover">
            Sign in
          </Link>
        </Typography>
      </Grid>
    </AuthScreen>
  )
}

export default SignUp
