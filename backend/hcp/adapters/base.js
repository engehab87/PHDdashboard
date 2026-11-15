'use strict';
/* Adapter contract. Every version-specific adapter implements:
   id, versionRange, authenticate(), getCapabilities(), fetchCategory(), normalize().
   All HCP traffic is read-only GET. No door-control / write operations exist here. */

class HcpAdapterBase {
  constructor({ compound, hcp, creds, net }) {
    this.compound = compound; this.hcp = hcp; this.creds = creds; this.net = net;
  }
  get id() { throw new Error('adapter id not implemented'); }
  async authenticate() { throw new Error('authenticate not implemented'); }
  async checkPermissions() { throw new Error('checkPermissions not implemented'); }
  async fetchCategory() { throw new Error('fetchCategory not implemented'); }
  normalize() { throw new Error('normalize not implemented'); }
  get mappingVersion() { return '1.0.0'; }
}

module.exports = { HcpAdapterBase };
