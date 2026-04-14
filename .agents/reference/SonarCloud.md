# SonarCloud

SonarCloud runs on every PR via GitHub Actions. The project key is
`hypercerts-org_ePDS`. Use the public API to check results — no
authentication required for public projects.

```bash
# Quality gate status for a PR
curl -s "https://sonarcloud.io/api/qualitygates/project_status?projectKey=hypercerts-org_ePDS&pullRequest=<N>" | python3 -m json.tool

# List new bugs on a PR
curl -s "https://sonarcloud.io/api/issues/search?componentKeys=hypercerts-org_ePDS&pullRequest=<N>&types=BUG&resolved=false" | python3 -c "
import sys,json
for i in json.load(sys.stdin).get('issues',[]):
    print(f'{i[\"component\"].split(\":\")[-1]}:{i.get(\"line\",\"?\")} — {i[\"message\"]}')"

# List all new issues (bugs, code smells, vulnerabilities)
curl -s "https://sonarcloud.io/api/issues/search?componentKeys=hypercerts-org_ePDS&pullRequest=<N>&resolved=false&ps=50" | python3 -c "
import sys,json
for i in json.load(sys.stdin).get('issues',[]):
    print(f'{i[\"type\"]:15} {i[\"component\"].split(\":\")[-1]}:{i.get(\"line\",\"?\")} — {i[\"message\"]}')"

# Duplication on new code
curl -s "https://sonarcloud.io/api/measures/component?component=hypercerts-org_ePDS&pullRequest=<N>&metricKeys=new_duplicated_lines_density" | python3 -m json.tool

# Security hotspots
curl -s "https://sonarcloud.io/api/hotspots/search?projectKey=hypercerts-org_ePDS&pullRequest=<N>" | python3 -c "
import sys,json
for h in json.load(sys.stdin).get('hotspots',[]):
    print(f'{h[\"component\"].split(\":\")[-1]}:{h.get(\"line\",\"?\")} — {h[\"message\"]}')"
```

## Quality gate thresholds

On new code: reliability A (no bugs), security A, maintainability A,
duplication < 3%, and 100% of security hotspots reviewed. Fix any
issues before merging.

## NOSONAR annotations

Test data that intentionally uses private IPs, `http://` URLs, or
other patterns Sonar would flag as security hotspots should have
`// NOSONAR` at the end of the line, with a brief reason:

```ts
['http://', 'http://example.com/data.json', /only https/i], // NOSONAR — testing SSRF guard
['private 10.x', 'https://10.0.0.1/path'], // NOSONAR — testing SSRF guard
```
