import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { ROLES } from '@nst/shared/permissions.js'
import { api } from '../api/client'

export const useAuthStore = create(
  persist(
    set => ({
      // State
      isAuthenticated: false,
      isLoading: true, // Start as true to check local tokens on boot
      user: null,

      // Actions
      login: userData => {
        set({
          isAuthenticated: true,
          user: userData,
          isLoading: false,
        })
      },
      logout: () => {
        set({
          isAuthenticated: false,
          user: null,
          isLoading: false,
        })
      },
      setLoading: isLoading => {
        set({ isLoading })
      },
      fetchUser: async () => {
        set({ isLoading: true })
        try {
          const response = await api.get('/auth/portfolio', {
            credentials: 'include',
          })
          set({
            isAuthenticated: true,
            user: response.data,
            isLoading: false,
          })
        } catch (error) {
          set({
            isAuthenticated: false,
            user: null,
            isLoading: false,
          })
          console.error('Error fetching user:', error)
        }
      },
    }),
    {
      name: 'auth-storage',
      storage: createJSONStorage(() => localStorage),
      // Not isLoading: every page load starts loading until fetchUser has
      // confirmed the session, so a stale saved role is never trusted.
      partialize: ({ user, isAuthenticated }) => ({ user, isAuthenticated }),
    }
  )
)

// Resolves with the auth state once the session check has finished.
export const whenAuthReady = () =>
  new Promise(resolve => {
    const state = useAuthStore.getState()
    if (!state.isLoading) {
      resolve(state)
      return
    }
    const unsubscribe = useAuthStore.subscribe(next => {
      if (!next.isLoading) {
        unsubscribe()
        resolve(next)
      }
    })
  })

// A student isn't part of the portal until they belong to a startup.
// A student onboards until their Google account is connected (so the KPI
// bot knows them in Meet transcripts) and they belong to a startup.
export const needsOnboarding = user =>
  user?.role?.name === ROLES.STUDENT &&
  (user.googleLinked === false || !user.venture)
