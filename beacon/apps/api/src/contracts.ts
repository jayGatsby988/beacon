import { z } from 'zod';
import { EnvelopeSchema } from '@beacon/protocol';
export const IncidentId = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const nodeId = z.string().regex(/^[0-9a-f]{64}$/);
export const EventSchema = z.object({
  id:z.string().regex(/^[a-zA-Z0-9:_-]{1,160}$/), deviceId:nodeId,
  sequence:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  recordedAt:z.number().int().min(946684800000).max(4102444800000),
  kind:z.string().regex(/^[a-z][a-z0-9_.-]{0,63}$/), requestId:nodeId.optional(),
  message:EnvelopeSchema.optional(), peerId:z.string().min(1).max(160).optional(),
}).strict().superRefine((event,ctx)=>{
  if(event.message && event.requestId !== event.message.requestId) ctx.addIssue({code:'custom',message:'requestId must match signed message'});
  if(event.message && ['inventory','missing'].includes(event.message.type)) ctx.addIssue({code:'custom',message:'Control messages are not incident records'});
});
// Per-item validation returns rejected IDs without dropping valid items in the batch.
export const BatchSchema=z.object({incidentId:IncidentId,events:z.array(z.unknown()).min(1).max(100)}).strict();
export type UploadEvent=z.infer<typeof EventSchema>;
export type ReplayEvent=UploadEvent & {ingestedAt:number};
export interface BatchResult {accepted:string[];duplicates:string[];rejected:{id:string;reason:string}[]}
export interface Principal {deviceId:string}
export interface ReplayPage {events:ReplayEvent[];updatedAt:number;incomplete:true;nextCursor?:string}
export interface Repository {
  authenticate(tokenHash:string):Promise<Principal|null>;
  isMember(deviceId:string,incidentId:string):Promise<boolean>;
  ingest(incidentId:string,deviceId:string,events:UploadEvent[]):Promise<BatchResult>;
  replay(incidentId:string,cursor?:string):Promise<ReplayPage>;
  summary(incidentId:string):Promise<Record<string,unknown>>;
  ready():Promise<void>;
}
