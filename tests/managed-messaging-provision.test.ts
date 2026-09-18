import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { advanceManagedNumber, type InkboxIdentity, type ManagedNumberOrder, type ManagedNumberPorts, MessagingProvisionError } from '../src/managed-messaging/index.js'

function fixture(transport: 'sms' | 'imessage' = 'sms') {
  let row: ManagedNumberOrder = { id:'order1',ownerId:'alice',handle:'tng-order1',organizationId:'org',transport,
    fundingAuthorizationId:'ledger-receipt',version:0,phase:'identity',attempted:false,status:'pending' }
  let identity: InkboxIdentity | null = null
  let credential: {key:string;keyId:string;identityId:string} | null = null
  let now=1_000_000
  let allowed=true, funded=true
  const counts={identity:0,number:0,key:0,bind:0,funding:0,verify:0}
  const number={id:'line1',number:'+15551112222',smsStatus:'ready',status:'active'}
  const ports: ManagedNumberPorts = {
    now:()=>now,
    orders:{get:async()=>structuredClone(row),saveIfVersion:async(next,version)=>{
      if(row.version!==version) return false; row=structuredClone(next);return true
    }},
    canProvision:async()=>allowed,
    authorizeFunding:async()=>{counts.funding++; return funded},
    provider:{
      getIdentity:async()=>structuredClone(identity),
      createIdentity:async()=>{counts.identity++;identity={id:'identity1',handle:'tng-order1',organizationId:'org',status:'active',imessageEnabled:false,sms:null,imessage:null};return structuredClone(identity)},
      claimIMessage:async()=>{counts.number++;identity={...identity!,imessageEnabled:true,imessage:number};return structuredClone(identity)},
      provisionSms:async()=>{counts.number++;identity={...identity!,sms:number};return {...number}},
      mintIdentityKey:async()=>{counts.key++;return {key:'secret-fixture',keyId:'key1'}},
      verifyIdentityKey:async()=>{counts.verify++},
    },
    vault:{read:async()=>structuredClone(credential),putIfAbsent:async(_id,value)=>{
      if(credential && JSON.stringify(credential)!==JSON.stringify(value)) throw new Error('conflict')
      credential=structuredClone(value)
    }},
    bindConnection:async()=>{counts.bind++;return 'connection1'},
  }
  const tick=()=>advanceManagedNumber('order1',ports)
  return {ports,counts,tick,get row(){return row},get identity(){return identity},
    setIdentity:(value:InkboxIdentity|null)=>{identity=value},setRow:(patch:Partial<ManagedNumberOrder>)=>{row={...row,...patch}},
    setAllowed:(value:boolean)=>{allowed=value},setFunded:(value:boolean)=>{funded=value},advance:()=>{now+=60_000},
    get credential(){return credential}, setCredential:(value:typeof credential)=>{credential=value}}
}

describe('recoverable managed number provisioning',()=>{
  for(const transport of ['sms','imessage'] as const) it(`provisions ${transport}, vaults a scoped key and stops before claiming handset readiness`,async()=>{
    const f=fixture(transport)
    for(let n=0;n<4;n++) await f.tick()
    assert.equal(f.row.status,'ready_for_setup');assert.equal(f.row.connectionId,'connection1')
    assert.deepEqual({identity:f.counts.identity,number:f.counts.number,key:f.counts.key,bind:f.counts.bind},{identity:1,number:1,key:1,bind:1})
    assert(!JSON.stringify(f.row).includes('secret-fixture'))
    await f.tick();assert.equal(f.counts.bind,1)
  })
  it('does no provider work when credentials or commercial activation are unavailable',async()=>{
    const f=fixture();f.setAllowed(false);await f.tick()
    assert.equal(f.row.errorCode,'activation_not_configured');assert.equal(f.counts.identity,0);assert.equal(f.counts.funding,0)
  })
  it('does no provider work without ledger authorization',async()=>{
    const f=fixture();f.setFunded(false);await f.tick();assert.equal(f.row.errorCode,'funding_required');assert.equal(f.counts.identity,0)
  })
  it('serializes concurrent initial calls through the atomic order version',async()=>{
    const f=fixture();await Promise.all(Array.from({length:12},()=>f.tick()))
    assert.equal(f.counts.identity,1)
  })
  it('recovers an identity created before a lost response without creating another',async()=>{
    const f=fixture();const create=f.ports.provider.createIdentity
    f.ports.provider.createIdentity=async handle=>{await create(handle);throw new MessagingProvisionError('outcome_unknown')}
    await f.tick();f.advance();await f.tick();assert.equal(f.row.phase,'number');assert.equal(f.counts.identity,1)
  })
  it('does not adopt an identity that existed before this order tried to create it',async()=>{
    const f=fixture();await f.ports.provider.createIdentity('tng-order1');await f.tick()
    assert.equal(f.row.errorCode,'identity_already_exists');assert.equal(f.row.identityId,undefined)
  })
  it('does not repeat a journaled identity POST with no recoverable receipt',async()=>{
    const f=fixture();f.setRow({attempted:true});await f.tick();assert.equal(f.row.errorCode,'identity_outcome_unknown');assert.equal(f.counts.identity,0)
  })
  it('refuses a provider account mismatch',async()=>{
    const f=fixture();await f.tick();f.setIdentity({...f.identity!,organizationId:'foreign'})
    await f.tick();assert.equal(f.row.status,'needs_review');assert.equal(f.counts.number,0)
  })
  it('recovers an SMS purchase whose HTTP response was lost',async()=>{
    const f=fixture();await f.tick();const buy=f.ports.provider.provisionSms
    f.ports.provider.provisionSms=async(...args)=>{await buy(...args);throw new MessagingProvisionError('outcome_unknown')}
    await f.tick();f.advance();await f.tick();assert.equal(f.row.phase,'credential');assert.equal(f.counts.number,1)
  })
  it('does not clear a prior unknown purchase after an unrelated read receives 401',async()=>{
    const f=fixture();await f.tick();f.setRow({attempted:true})
    f.ports.provider.getIdentity=async()=>{throw new MessagingProvisionError('provider_rejected',401)}
    await f.tick();assert.equal(f.row.attempted,true);assert.equal(f.counts.number,0)
  })
  it('waits for SMS readiness without buying another number',async()=>{
    const f=fixture();await f.tick();f.ports.provider.provisionSms=async()=>{
      f.counts.number++;const pending={id:'line1',number:'+15551112222',smsStatus:'pending',status:'active'}
      f.setIdentity({...f.identity!,sms:pending});return pending
    }
    await f.tick();assert.equal(f.row.errorCode,'sms_not_ready');assert.equal(f.counts.key,0)
    f.advance();await f.tick();assert.equal(f.counts.number,1)
    f.setIdentity({...f.identity!,sms:{...f.identity!.sms!,smsStatus:'ready',status:'active'}})
    f.advance();await f.tick();assert.equal(f.row.phase,'credential')
  })
  it('does not mint another credential after its once-shown receipt is lost',async()=>{
    const f=fixture();await f.tick();await f.tick()
    f.ports.provider.mintIdentityKey=async()=>{f.counts.key++;throw new MessagingProvisionError('outcome_unknown')}
    await f.tick();f.advance();await f.tick()
    assert.equal(f.row.errorCode,'credential_receipt_lost');assert.equal(f.counts.key,1)
  })
  it('recovers when encryption completed before the order update was lost',async()=>{
    const f=fixture();await f.tick();await f.tick()
    const put=f.ports.vault.putIfAbsent
    f.ports.vault.putIfAbsent=async(id,value)=>{await put(id,value);throw new Error('process interrupted after durable write')}
    await f.tick();f.advance();await f.tick()
    assert.equal(f.row.phase,'connection');assert.equal(f.counts.key,1)
  })
  it('persists the credential before attempting key-scope verification',async()=>{
    const f=fixture();await f.tick();await f.tick()
    f.ports.provider.verifyIdentityKey=async()=>{assert.equal(f.credential?.key,'secret-fixture');throw new Error('read temporarily unavailable')}
    await f.tick();assert.equal(f.counts.key,1);f.advance();await f.tick();assert.equal(f.counts.key,1)
  })
  it('does not bind a changed provider number to the original customer',async()=>{
    const f=fixture();await f.tick();await f.tick();f.setIdentity({...f.identity!,sms:{...f.identity!.sms!,id:'foreign-line'}})
    await f.tick();assert.equal(f.row.status,'needs_review');assert.equal(f.counts.key,0)
  })
  it('rechecks cancellation after a slow funding check, before the provider call',async()=>{
    const f=fixture();f.ports.authorizeFunding=async()=>{f.setRow({status:'cancelled',version:f.row.version+1});return true}
    await f.tick();assert.equal(f.row.status,'cancelled');assert.equal(f.counts.identity,0)
  })
  it('does not buy a second number when the ownership read after a purchase fails',async()=>{
    const f=fixture();await f.tick()
    const read=f.ports.provider.getIdentity;let purchased=false
    const buy=f.ports.provider.provisionSms
    f.ports.provider.provisionSms=async(...args)=>{const line=await buy(...args);purchased=true;return line}
    // The purchase lands, but the identity read that follows it fails.
    f.ports.provider.getIdentity=async handle=>{if(purchased)throw new MessagingProvisionError('provider_rejected',503);return read(handle)}
    await f.tick();assert.equal(f.row.attempted,true);assert.equal(f.counts.number,1)
    // The provider has not yet attached the line to the identity: review, never repurchase.
    f.ports.provider.getIdentity=async()=>({...f.identity!,sms:null})
    f.advance();await f.tick();assert.equal(f.counts.number,1);assert.equal(f.row.errorCode,'number_outcome_unknown')
  })
  it('permits another attempt only when the purchase itself is refused',async()=>{
    const f=fixture();await f.tick()
    f.ports.provider.provisionSms=async()=>{f.counts.number++;throw new MessagingProvisionError('provider_rejected',402)}
    await f.tick();assert.equal(f.row.attempted,false);assert.equal(f.row.errorCode,'provider_rejected')
  })
  it('sends each SMS purchase with the order operation key',async()=>{
    const f=fixture();await f.tick();const keys:string[]=[]
    const buy=f.ports.provider.provisionSms
    f.ports.provider.provisionSms=async(handle,operationId,state)=>{keys.push(operationId);return buy(handle,operationId,state)}
    await f.tick();assert.deepEqual(keys,['order1:sms'])
  })
  it('releases the attempt journal when authorization fails before any provider call',async()=>{
    const f=fixture();let checks=0
    f.ports.authorizeFunding=async()=>{f.counts.funding++;if(++checks===1)throw new Error('ledger timeout');return true}
    await f.tick();assert.equal(f.row.attempted,false);assert.equal(f.counts.identity,0)
    f.advance();await f.tick();assert.equal(f.row.phase,'number');assert.equal(f.counts.identity,1)
  })
  it('releases the attempt journal when funding is refused on the recheck',async()=>{
    const f=fixture();let checks=0
    f.ports.authorizeFunding=async()=>{f.counts.funding++;return ++checks!==1}
    await f.tick();assert.equal(f.row.attempted,false);assert.equal(f.row.errorCode,'funding_required');assert.equal(f.counts.identity,0)
  })
  it('waits for an accepted iMessage claim to receive its line without review',async()=>{
    const f=fixture('imessage');await f.tick()
    f.ports.provider.claimIMessage=async()=>{f.counts.number++;f.setIdentity({...f.identity!,imessageEnabled:true,imessage:null});return structuredClone(f.identity!)}
    await f.tick();assert.equal(f.row.errorCode,'number_pending');assert.equal(f.row.status,'provider_pending')
    f.advance();await f.tick();assert.equal(f.row.errorCode,'number_pending');assert.equal(f.counts.number,1)
    f.setIdentity({...f.identity!,imessage:{id:'line1',number:'+15551112222',smsStatus:null,status:'active'}})
    f.advance();await f.tick();assert.equal(f.row.phase,'credential');assert.equal(f.counts.number,1)
  })
  it('records a number bought while the order was cancelled',async()=>{
    const f=fixture();await f.tick()
    const buy=f.ports.provider.provisionSms
    f.ports.provider.provisionSms=async(...args)=>{const line=await buy(...args);f.setRow({status:'cancelled',version:f.row.version+1});return line}
    await f.tick()
    assert.equal(f.row.status,'cancelled');assert.equal(f.row.number?.id,'line1');assert.equal(f.counts.number,1)
  })
  it('backs off an order that cannot be funded',async()=>{
    const f=fixture();f.setFunded(false);await f.tick()
    assert.equal(f.row.errorCode,'funding_required');assert.ok((f.row.nextAttemptAt??0)>1_000_000)
    await f.tick();assert.equal(f.counts.funding,1)
    f.setFunded(true);f.advance();await f.tick();assert.equal(f.row.phase,'number')
  })
  it('clears the purchase journal once a number is recorded while SMS readiness settles',async()=>{
    const f=fixture();await f.tick();f.ports.provider.provisionSms=async()=>{
      f.counts.number++;const pending={id:'line1',number:'+15551112222',smsStatus:'pending',status:'active'}
      f.setIdentity({...f.identity!,sms:pending});return pending
    }
    await f.tick();assert.equal(f.row.errorCode,'sms_not_ready');assert.equal(f.row.attempted,false);assert.equal(f.row.number?.id,'line1')
  })
  it('reviews rather than repurchases when a recorded number disappears',async()=>{
    const f=fixture();await f.tick();f.ports.provider.provisionSms=async()=>{
      f.counts.number++;const pending={id:'line1',number:'+15551112222',smsStatus:'pending',status:'active'}
      f.setIdentity({...f.identity!,sms:pending});return pending
    }
    await f.tick();f.setIdentity({...f.identity!,sms:null})
    f.advance();await f.tick();assert.equal(f.row.errorCode,'number_missing');assert.equal(f.counts.number,1)
  })
  it('lets a concurrent progress check wait for a purchase still in flight',async()=>{
    const f=fixture();await f.tick()
    const buy=f.ports.provider.provisionSms;let release!:()=>void
    const gate=new Promise<void>(resolve=>{release=resolve})
    f.ports.provider.provisionSms=async(...args)=>{await gate;return buy(...args)}
    const worker=f.tick()
    await new Promise(resolve=>setTimeout(resolve,0))
    assert.equal(f.row.attempted,true)
    await f.tick()
    assert.equal(f.row.status,'pending');assert.equal(f.row.errorCode,undefined)
    release();await worker
    assert.equal(f.row.phase,'credential');assert.equal(f.row.number?.id,'line1');assert.equal(f.counts.number,1)
  })
  it('sends a journaled call from a crashed worker to review once its lease passes',async()=>{
    const f=fixture();await f.tick();f.setRow({attempted:true,attemptedAt:1_000_000})
    await f.tick();assert.equal(f.row.status,'pending');assert.equal(f.counts.number,0)
    for(let n=0;n<5;n++) f.advance()
    await f.tick();assert.equal(f.row.errorCode,'number_outcome_unknown');assert.equal(f.counts.number,0)
  })
  it('reconciles a completed purchase after its funding hold expired',async()=>{
    const f=fixture();await f.tick()
    const buy=f.ports.provider.provisionSms
    f.ports.provider.provisionSms=async(...args)=>{await buy(...args);throw new MessagingProvisionError('outcome_unknown')}
    await f.tick();assert.equal(f.row.attempted,true)
    f.setFunded(false);const funding=f.counts.funding
    f.advance();await f.tick()
    assert.equal(f.row.phase,'credential');assert.equal(f.row.number?.id,'line1');assert.equal(f.counts.funding,funding)
  })
  it('does not mutate a stopped order',async()=>{
    const f=fixture();f.setRow({status:'cancelled'});await f.tick();assert.equal(f.counts.funding,0);assert.equal(f.counts.identity,0)
  })
})
