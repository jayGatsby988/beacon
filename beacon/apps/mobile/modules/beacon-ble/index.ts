import { NativeModule, requireNativeModule } from 'expo-modules-core';
export const SERVICE_UUID = '7C51A100-1B15-4F0D-9B8D-0E4B8D638010';
export const WRITE_UUID = '7C51A101-1B15-4F0D-9B8D-0E4B8D638010';
export const NOTIFY_UUID = '7C51A102-1B15-4F0D-9B8D-0E4B8D638010';
export const MAX_MESSAGE_BYTES = 16384;
export type BleState = { state: 'poweredOn'|'poweredOff'|'unauthorized'|'unsupported'|'unknown'; advertising: boolean; scanning: boolean };
export type BlePeer = {peerId: string; nodeId?: string; state: 'discovered'|'connected'|'disconnected'; rssi?: number; mtu?: number};
export type BleError = {code: string; message: string; peerId?: string};
export type BleEvents = {onPeer: (event: BlePeer) => void; onData: (event: {peerId: string; base64: string}) => void; onState: (event: BleState) => void; onError: (event: BleError) => void};
export declare class BeaconBleNativeModule extends NativeModule<BleEvents> {
  start(options: {nodeId: string; serviceUuid?: string}): Promise<BleState>;
  stop(): Promise<void>;
  send(peerId: string, base64: string): Promise<void>;
  getState(): Promise<BleState>;
}
// Throws explicitly in Expo Go or builds lacking this local module.
export default requireNativeModule<BeaconBleNativeModule>('BeaconBle');
