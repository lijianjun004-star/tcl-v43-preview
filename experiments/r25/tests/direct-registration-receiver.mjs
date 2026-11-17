import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveOperatorName} from '../tcl-v352-asr-r25-qa/cloud-workspace.mjs';
const rows=[{uid:'stable-a',displayName:'运营甲',role:'operator',active:true},{uid:'stable-b',displayName:'运营乙',role:'operator',active:true}];
test('exact normalized name resolves immutable recipient uid',()=>{
 assert.equal(resolveOperatorName(rows,' 运营甲 '),'stable-a');
 assert.equal(resolveOperatorName([{uid:'fullwidth',displayName:'运营(A)',role:'operator'}],'运营（A）'),'fullwidth');
});
test('missing, partial, disabled, and nonoperator recipients fail closed',()=>{
 for(const value of ['', '运营', '不存在'])assert.throws(()=>resolveOperatorName(rows,value));
 assert.throws(()=>resolveOperatorName([{uid:'x',displayName:'运营甲',role:'operator',active:false}],'运营甲'));
 assert.throws(()=>resolveOperatorName([{uid:'x',displayName:'运营甲',role:'anchor'}],'运营甲'));
 assert.throws(()=>resolveOperatorName([{displayName:'运营甲',role:'operator'}],'运营甲'));
});
test('ambiguous exact names never choose the first UID',()=>{
 assert.throws(()=>resolveOperatorName([...rows,{uid:'other',displayName:'运营甲',role:'operator'}],'运营甲'),/多个账号/);
});

test('admin recipients and case folding align with the authoritative registry',()=>{
 assert.equal(resolveOperatorName([{uid:'admin-id',displayName:'Admin A',role:'admin'}],'admin a'),'admin-id');
 assert.throws(()=>resolveOperatorName([{uid:'x',displayName:'运营甲'}],'运营甲'));
});
