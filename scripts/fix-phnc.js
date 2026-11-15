const { db } = require('../backend/db');
db.prepare("UPDATE compound_hcp SET hcp_host='192.168.15.15', https=1, tls_verify=1, tls_ca=NULL, base_url='https://192.168.15.15:443/artemis/api', version_source='manual', hcp_version='2.6.0', openapi_version='2.6' WHERE compound_id=3").run();
const hcp = db.prepare('SELECT hcp_host, hcp_port, https, tls_verify, tls_ca, base_url, version_source, hcp_version, openapi_version FROM compound_hcp WHERE compound_id=3').get();
console.log('Updated HCP config:', JSON.stringify(hcp, null, 2));
db.close();
