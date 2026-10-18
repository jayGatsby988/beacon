package expo.modules.beaconble

fun main() {
  val policy = BeaconScanPolicy()
  check(policy.canStart(100))
  policy.started(100)
  // The real two-second native timer must not churn new scan registrations.
  for (now in listOf(100L, 2_100L, 4_100L, 6_100L, 8_100L, 10_099L)) check(!policy.canStart(now))
  check(policy.canStart(10_100))
  policy.started(10_100)
  policy.failed(10_200, 3)
  check(!policy.canStart(20_199))
  check(policy.canStart(20_200))
  policy.started(20_200)
  policy.failed(20_300, 6)
  for (now in 20_300L until 50_300L step 2_000L) check(!policy.canStart(now))
  // A later ordinary failure cannot shorten the rate-limit quarantine.
  policy.failed(21_000, 2)
  check(!policy.canStart(50_299))
  check(policy.canStart(50_300))
  policy.started(50_300)
  check(!policy.canStart(60_299))
  check(policy.canStart(60_300))
  println("Native discovery policy passed: initial scan, timer pacing, ordinary failure, rate-limit backoff, retry boundary.")
}
