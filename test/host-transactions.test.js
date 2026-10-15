import test from "node:test";
import assert from "node:assert/strict";
import { hostTransactionPresentation, hostEarnedTotal } from "../src/lib/hostTransactions.js";

test("refunded transactions remain visible but never show as earned income", () => {
  assert.deepEqual(hostTransactionPresentation({status:"refunded",net:10}), {label:"Refunded",isIncome:false});
  assert.deepEqual(hostTransactionPresentation({status:"disputed",net:10}), {label:"Disputed",isIncome:false});
  assert.deepEqual(hostTransactionPresentation({status:"partially_refunded",net:10}), {label:"Partially refunded",isIncome:false});
});
test("confirmed and completed transactions contribute to earnings", () => {
  assert.deepEqual(hostTransactionPresentation({status:"confirmed",net:10}), {label:"Earned",isIncome:true});
  assert.equal(hostEarnedTotal([
    {status:"confirmed",net:10},
    {status:"completed",net:5},
    {status:"refunded",net:11},
    {status:"disputed",net:17},
    {status:"pending",net:12}
  ]),15);
});
test("unknown statuses fail closed and are not presented as earnings", () => {
  assert.equal(hostTransactionPresentation({status:"surprise"}).isIncome,false);
});
