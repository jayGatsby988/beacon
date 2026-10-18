# Beacon build agreement

User overrides: Product is Beacon. Gray palette and one red focal action. Two primary views, I need help and Help nearby. Maps in request details. Foreground BLE first. No invented delivery or hardware validation. Authorized mock-hackathon/research; document AI assistance and account rotation transparently.

Repo root is this beacon directory. Parent is an empty Git repository, so root agent owns all git operations. Agents must NOT commit, push, alter other workstreams, create goals, or spawn agents without coordinating.

Ownership wave 1:
- Native specialist: apps/mobile/modules/beacon-ble/**, docs/NATIVE_TRANSPORT.md
- Protocol specialist: packages/protocol/** and tests/protocol/**, docs/PROTOCOL.md
- Interface specialist: apps/mobile/app/**, apps/mobile/src/components/**, apps/mobile/src/theme/**, apps/mobile/src/features/**, apps/mobile/src/ui/**, docs/DESIGN.md
- Root: toolchain/package manifests, services/storage/integration, build and installation, branding assets.

Native API intended: start({nodeId:string,serviceUuid?:string}), stop(), send(peerId:string,base64:string), getState(). Events onPeer {peerId,nodeId?,state:'discovered'|'connected'|'disconnected',rssi?,mtu?}; onData {peerId,base64}; onState {state:'poweredOn'|'poweredOff'|'unauthorized'|'unsupported'|'unknown',advertising:boolean,scanning:boolean}; onError {code,message,peerId?}. send resolves after BLE writes complete, NOT recipient persistence. Handshake handled in shared protocol; peerId is session identifier only. Native performs bounded fragmentation/reassembly for complete base64 application messages. Fixed service 7C51A100-1B15-4F0D-9B8D-0E4B8D638010, write characteristic ...A101..., notify ...A102.... iOS and Android same framing. Expo module name BeaconBle.

UI reads a hook from src/services/BeaconContext.tsx to be coordinated with root; write a typed desired contract in src/ui/types.ts and tell root immediately. No synthetic live data. Root will implement context. Frontend must be functional against real domain service. No package manifest edits by UI agent.
