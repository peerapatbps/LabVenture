const fetch = require('node-fetch');
require('dotenv').config();

const REST_BASE = process.env.AQUADAT_REST_BASE || 'http://aquadat.mwa.co.th:12007';
const GRAPHQL_URL = process.env.AQUADAT_GRAPHQL_URL || 'https://aquadat.mwa.co.th/graphql';

// REST login → returns token string
async function restLogin(username, password) {
  const url = `${REST_BASE}/api/aquaDATService/Enroll`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error(`AquaDAT login failed: ${res.status}`);
  const data = await res.json();
  // The token may be at data.token or data.access_token — try both
  const token = data.results?.token || data.token || data.access_token;
  if (!token) throw new Error('No token in AquaDAT response');
  return token;
}

// GraphQL login → returns token string (for write/remarks)
// SOP ภาคผนวก 3.1: inline logIn mutation, token returned as data.logIn directly
async function graphqlLogin(username, password) {
  const payload = {
    operationName: null,
    variables: {},
    query: `mutation { logIn(user_name: "${username}", user_pwd: "${password}") }`,
  };
  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`GraphQL login failed: ${res.status}`);
  const data = await res.json();
  if (data.errors) throw new Error(data.errors[0]?.message || 'GraphQL login error');
  const token = data.data?.logIn;
  if (!token) throw new Error('No token in GraphQL login response');
  return token;
}

// Read production data via REST (Intranet only)
async function readData({ token, plant_id, stationtype_code, begin_dt, end_dt, format = 'json' }) {
  const params = new URLSearchParams({ token, plant_id, stationtype_code, begin_dt, end_dt, format });
  const url = `${REST_BASE}/api/aquaDATService/Data?${params}`;
  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) throw new Error(`AquaDAT read failed: ${res.status}`);
  if (format === 'json') return res.json();
  return res.text();
}

// Write data via GraphQL mutation
// SOP ภาคผนวก 3.2: update_transaction_datavalues with inline input_data array
async function writeData(token, records) {
  const inputItems = records.map(r => {
    const date       = r.trans_dtm   || r.date  || '';
    const time       = r.trans_time  || r.time  || '';
    const value      = String(r.trans_value ?? r.value ?? '');
    const trans_type = r.trans_type  ?? '';
    return `{ date: "${date}", configparam_id: ${r.configparam_id}, time: "${time}", value: "${value}", trans_type: "${trans_type}", flag_value: "0" }`;
  });
  const payload = {
    variables: {},
    query: `mutation { update_transaction_datavalues(input_data: [${inputItems.join(', ')}]) { return_status return_message __typename } }`,
  };
  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`GraphQL write failed: ${res.status}`);
  const data = await res.json();
  if (data.errors) throw new Error(data.errors[0]?.message || 'GraphQL write error');
  const result = data.data?.update_transaction_datavalues;
  if (result && result.return_status === false) {
    throw new Error(result.return_message || 'AquaDAT write returned false status');
  }
  return result;
}

// Read remarks via GraphQL
// SOP ภาคผนวก 4: get_transaction_remark inline, dates in YYYYMMDD format
async function readRemarks(token, { plant_id, station_id = 0, begin_dt, end_dt, load_file_data = true }) {
  const payload = {
    variables: {},
    query: `{ get_transaction_remark(
      trans_remark_id: 0,
      user_id: 0,
      plant_id: ${plant_id},
      station_id: ${station_id},
      trans_remark_date: "${begin_dt}",
      trans_remark_date_end: "${end_dt}",
      trans_type: "",
      load_file_data: ${load_file_data}
    ) {
      trans_remark_id
      station_name_th
      trans_remark_date
      description
      created_user
      created_dtm
      updated_dtm
      file_datas
      user_profile
    } }`,
  };
  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`,
      'credentials': 'include',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`GraphQL remarks failed: ${res.status}`);
  const data = await res.json();
  if (data.errors) throw new Error(data.errors[0]?.message || 'GraphQL remarks error');
  return data.data?.get_transaction_remark || [];
}

// Fetch current user profile from AquaDAT GraphQL (get_user_info)
async function fetchUserProfile(token) {
  const query = `query {
    get_user_info {
      user_id
      title_name
      first_name
      last_name
      position_name
      user_profile
    }
  }`;
  try {
    const res = await fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const u = data.data?.get_user_info?.[0];
    if (!u) return null;
    // Thai name: title+first (no space) + space + last → "นายพีรพัฒน์ สุขขารมย์"
    const firstPart = [u.title_name, u.first_name].filter(Boolean).join('');
    const name = [firstPart, u.last_name].filter(Boolean).join(' ');
    return {
      name: name || null,
      position: u.position_name || null,
      avatarUrl: u.user_profile || null,
    };
  } catch {
    return null;
  }
}

module.exports = { restLogin, graphqlLogin, readData, writeData, readRemarks, fetchUserProfile };
