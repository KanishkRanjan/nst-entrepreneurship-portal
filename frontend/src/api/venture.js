import { api } from './client'
import toError from './toError'

export const getVentures = async () => {
  const { data } = await api.get('/ventures')

  return data
}

export const getMyJoinRequest = async () => {
  const { data } = await api.get('/ventures/join-requests/me')

  return data.joinRequest
}

export const applyToVenture = async (ventureId, message) => {
  try {
    const { data } = await api.post(`/ventures/${ventureId}/join`, { message })

    return { joinRequest: data.joinRequest }
  } catch (err) {
    return toError(err, 'Could not submit join request')
  }
}

export const ventureDetailLoader = async ({ params }) => {
  const [{ data: ventureData }, biweeklyRes] = await Promise.all([
    api.get(`/ventures/${params.ventureId}`),
    api
      .get('/biweekly', { params: { ventureId: params.ventureId } })
      .catch(() => ({ data: null })),
  ])

  return {
    ...ventureData,
    biweekly: biweeklyRes?.data,
  }
}

export const venturesPageLoader = async () => {
  const [ventures, applications] = await Promise.all([
    api.get('/ventures'),
    api.get('/admin/applications'),
  ])

  return {
    ventures: ventures.data,
    proposals: applications.data.proposals,
    joinRequests: applications.data.joinRequests,
  }
}

export const reviewProposal = async (proposalId, status, remarks) => {
  try {
    const { data } = await api.patch(`/admin/proposals/${proposalId}/review`, {
      status,
      remarks,
    })

    return { proposal: data.proposal }
  } catch (err) {
    return toError(err, 'Could not review proposal')
  }
}

export const reviewJoinRequest = async (requestId, status) => {
  try {
    const { data } = await api.patch(
      `/admin/join-requests/${requestId}/review`,
      { status }
    )

    return { joinRequest: data.joinRequest }
  } catch (err) {
    return toError(err, 'Could not review join request')
  }
}
