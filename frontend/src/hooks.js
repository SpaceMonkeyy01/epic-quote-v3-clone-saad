import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import * as Q from './api/quotes'
import * as M from './api/meta'

export const useConstants = () =>
  useQuery({ queryKey: ['constants'], queryFn: M.getConstants, staleTime: Infinity })

export const useDashboard = () =>
  useQuery({ queryKey: ['dashboard'], queryFn: M.getDashboard })

export const useQuotes = (params) =>
  useQuery({ queryKey: ['quotes', params], queryFn: () => Q.listQuotes(params) })

export const useSalesReps = () =>
  useQuery({ queryKey: ['sales-reps'], queryFn: M.getSalesReps })

export const useActivity = (params = {}) =>
  useQuery({ queryKey: ['activity', params], queryFn: () => M.getActivity(params) })

// Invalidate everything that a quote mutation can affect
function useQuoteInvalidation() {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: ['quotes'] })
    qc.invalidateQueries({ queryKey: ['dashboard'] })
  }
}

export const useCreateQuote = () => {
  const invalidate = useQuoteInvalidation()
  return useMutation({ mutationFn: Q.createQuote, onSuccess: invalidate })
}

export const useUpdateQuote = () => {
  const invalidate = useQuoteInvalidation()
  return useMutation({ mutationFn: ({ id, patch }) => Q.updateQuote(id, patch), onSuccess: invalidate })
}

export const useUpdateStatus = () => {
  const invalidate = useQuoteInvalidation()
  return useMutation({ mutationFn: ({ id, status }) => Q.updateStatus(id, status), onSuccess: invalidate })
}

export const useUpdateTags = () => {
  const invalidate = useQuoteInvalidation()
  return useMutation({ mutationFn: ({ id, tags }) => Q.updateTags(id, tags), onSuccess: invalidate })
}

export const useDeleteQuote = () => {
  const invalidate = useQuoteInvalidation()
  return useMutation({ mutationFn: Q.deleteQuote, onSuccess: invalidate })
}
