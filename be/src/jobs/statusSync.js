import { getAllJobs, updateJobResult, updateJobStatus, updateSecondaryJob } from "../services/jobStore.js"
import { getJobResult, getJobStatus } from "../services/opusApiService.js"
import { mergeWorkflowOutputs } from "../utils/workflowOutputMerger.js"

export const syncStatus = async () => {
  console.log("Syncing job statuses…")
    const jobs = getAllJobs()
   await handlePrimaryJobs(jobs)
   await handleSecondaryJobs(jobs)
}

const handlePrimaryJobs = async (jobs) => {
  
    const inprogressJobs = jobs.filter(
      (j) =>
        !['COMPLETED', 'FAILED', 'CANCELLED', 'NOT_STARTED'].includes(j.status) &&
        !String(j.jobId || '').startsWith('-')
    )
    
    for(let job of inprogressJobs){
        console.log(`Checking status for job ${job.jobId}`)
        try {
          const jobStatus = await getJobStatus(job.jobId)
          const opusStatus = jobStatus?.status
          console.log(`Job ${job.jobId} status: ${opusStatus}`)

          // Normalise: Opus uses IN_PROGRESS (underscore); keep local as IN PROGRESS (space)
          if (opusStatus && opusStatus !== 'IN_PROGRESS') {
              await updateJobStatus(job.jobId, opusStatus)
          }

          if (opusStatus === 'COMPLETED') {
              const jobResult = await getJobResult(job.jobId)
              const resultFormated = extractKeyValue(jobResult)
              // Apply workflow output merging to get normalized field names
              const mergedOutputs = mergeWorkflowOutputs(resultFormated)
              await updateJobResult(job.jobId, { ...resultFormated, ...mergedOutputs })
              console.log(`Job ${job.jobId} completed and results saved`)
          }
        } catch (err) {
          console.error(`Status check failed for job ${job.jobId}: ${err.message}`)
          // If this job has been failing across syncs, mark it FAILED to stop retrying
          if (job._syncFailCount >= 5) {
            await updateJobStatus(job.jobId, 'FAILED').catch(() => {})
          } else {
            await updateJobResult(job.jobId, { _syncFailCount: (job._syncFailCount || 0) + 1 }).catch(() => {})
          }
        }
    }
}

const handleSecondaryJobs = async (jobs) => {
  
    const inprogressJobs = jobs.filter(j => j.secondaryStatus && !['COMPLETED', 'FAILED', 'CANCELLED'].includes(j.secondaryStatus))
    
    for(let job of inprogressJobs){
        console.log(`Checking status for secondary job ${job.secondaryJobId}`)
        try {
          const jobStatus = await getJobStatus(job.secondaryJobId)
          const opusStatus = jobStatus?.status
          console.log(`Secondary job ${job.secondaryJobId} status: ${opusStatus}`)

          if (opusStatus && opusStatus !== 'IN_PROGRESS') {
              await updateSecondaryJob(job.secondaryJobId, {secondaryStatus: opusStatus})
          }

          if (opusStatus === 'COMPLETED') {
              const jobResult = await getJobResult(job.secondaryJobId)
              const resultFormated = extractKeyValue(jobResult)
              // Apply workflow output merging to get normalized field names
              const mergedOutputs = mergeWorkflowOutputs(resultFormated)
              await updateSecondaryJob(job.secondaryJobId, { ...resultFormated, ...mergedOutputs })
              console.log(`Secondary job ${job.secondaryJobId} completed`)
          }
        } catch (err) {
          console.error(`Status check failed for secondary job ${job.secondaryJobId}: ${err.message}`)
        }
    }
}

function extractKeyValue(payload) {
  const result = {};

  Object.entries(payload.jobResultsPayloadSchema).forEach(
    ([key, obj]) => {
      // Store by the workflow_output_* key
      result[key] = obj.value;
      
      // Also store by display_name so mergeWorkflowOutputs can find it
      if (obj.display_name) {
        result[obj.display_name] = obj.value;
      }
      
      // Also store by variable_name if different from key
      if (obj.variable_name && obj.variable_name !== key) {
        result[obj.variable_name] = obj.value;
      }
    }
  );

  return result;
}
