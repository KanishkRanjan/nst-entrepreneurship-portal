import { api } from './client'
import toError from './toError'

export const foundersLoader = async () => {
  const { data } = await api.get('/admin/founders')
  return data
}

export const foundersCount = async () => {
  const { data } = await api.get('/admin/overview')
  return data
}

export const addFounderLoader = async () => {
  const { data } = await api.get('/admin/founder-options')
  return data
}

export const biWeeklyLoader = async ({ params }) => {
  const [{ data: biweekly }, kpisRes] = await Promise.all([
    api.get('/biweekly', {
      params: {
        ventureId: params?.ventureId,
        founderId: params?.userid,
      },
    }),
    api
      .get(`/kpis/founder/${params?.userid}`)
      .catch(() => ({ data: { data: [] } })),
  ])
  return {
    ...biweekly,
    kpis: kpisRes.data?.data || [],
  }
}

export const createFounder = async payload => {
  try {
    const { data } = await api.post('/admin/founders', payload)

    return { created: data }
  } catch (err) {
    return toError(err, 'Could not add founder')
  }
}

export const deleteFounders = async founders => {
  try {
    const { data } = await api.delete('/admin/founders/delete', {
      data: { founders },
    })

    return { data }
  } catch (err) {
    return toError(err, 'Failed to delete founders')
  }
}
