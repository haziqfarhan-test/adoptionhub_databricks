import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '',
})

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const bytes = new Uint8Array(reader.result)
      let binary = ''
      for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
      resolve({ filename: file.name, content_b64: btoa(binary) })
    }
    reader.onerror = reject
    reader.readAsArrayBuffer(file)
  })
}

export async function parseFile(file) {
  const body = await fileToBase64(file)
  const { data } = await api.post('/api/parse-file', body)
  return data
}

export async function enrichWithAI(columns) {
  const { data } = await api.post('/api/enrich-columns', { columns })
  return data
}

export async function saveConfig(tableConfig) {
  const { data } = await api.post('/api/save-config', tableConfig)
  return data
}

export async function listConfigs() {
  const { data } = await api.get('/api/configs')
  return data
}

export async function uploadToVolume(file, volumePath) {
  const body = await fileToBase64(file)
  const { data } = await api.post('/api/upload-to-volume', { ...body, volume_path: volumePath })
  return data
}

export async function runJob(jobNameConfig, domain, frequency) {
  const { data } = await api.post('/api/run-job', {
    job_name_config: jobNameConfig,
    domain,
    frequency,
  })
  return data
}

export async function getJobRunStatus(runId) {
  const { data } = await api.get(`/api/job-run-status/${runId}`)
  return data
}

export async function parseDictionary(file) {
  const body = await fileToBase64(file)
  const { data } = await api.post('/api/parse-dictionary', body)
  return data
}

export async function generateDictLogic(elementName, technicalLogic, description) {
  const { data } = await api.post('/api/generate-dict-logic', {
    element_name:    elementName,
    technical_logic: technicalLogic,
    description:     description,
  })
  return data
}

export async function uploadDictionary(dataDictionary, masterCode, filename) {
  const { data } = await api.post('/api/upload-dictionary', {
    data_dictionary: dataDictionary,
    master_code:     masterCode,
    filename,
  })
  return data
}

export async function getJobRunLogs(layer) {
  const { data } = await api.get('/api/job-run-logs', { params: { layer } })
  return data
}

export async function runBronzeToSilver(domain, frequency) {
  const { data } = await api.post('/api/run-bronze-to-silver', { domain, frequency })
  return data
}

// ── Job Run module ──────────────────────────────────────────────────────────

export async function listJobRunEntities() {
  const { data } = await api.get('/api/job-run/entities')
  return data
}

export async function runJobEntities(selectedJobNames, domain, frequency) {
  const { data } = await api.post('/api/job-run/run', {
    selected_job_names: selectedJobNames,
    domain,
    frequency,
  })
  return data
}

export async function runJob20(domain, frequency) {
  const { data } = await api.post('/api/job-run/run-job20', { domain, frequency })
  return data
}

export async function getJobRunLogsAll() {
  const { data } = await api.get('/api/job-run/logs')
  return data
}

export async function profileFile(file) {
  const body = await fileToBase64(file)
  const { data } = await api.post('/api/profile-file', body)
  return data
}