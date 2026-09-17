import { api } from './client'

export const biWeeklyLoader = async ({ params }) => {
  const { data } = await api.get('/biweekly', {
    params: {
      ventureId: params?.ventureId,
      founderId: params?.userid,
    },
  })
  return data
}

export const submitBiWeeklyCycle = async payload => {
  const { data } = await api.post('/biweekly/submission', payload)
  return data
}

export const saveBiWeeklyObservation = async payload => {
  const { data } = await api.post('/biweekly/observation', payload)
  return data
}

export const saveBiWeeklyEvaluation = async payload => {
  const { data } = await api.post('/biweekly/evaluation', payload)
  return data
}

export const reopenBiWeeklySubmission = async (target, cycleNumber) => {
  const payload =
    typeof target === 'object' && target !== null
      ? target
      : { founderId: target, cycle_number: cycleNumber }

  if (cycleNumber && !payload.cycle_number) {
    payload.cycle_number = cycleNumber
  }

  const { data } = await api.post('/biweekly/reopen', payload)
  return data
}

