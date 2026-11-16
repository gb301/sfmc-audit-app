import React, { createContext, useContext, useState, useEffect } from 'react';
import { listOrgs } from '../utils/api';

const OrgContext = createContext(null);

export function OrgProvider({ children }) {
  const [orgs, setOrgs]           = useState([]);
  const [activeOrg, setActiveOrg] = useState(null);
  const [loading, setLoading]     = useState(true);

  const refresh = async () => {
    try {
      const data = await listOrgs();
      setOrgs(data);
      if (!activeOrg && data.length > 0) setActiveOrg(data[0]);
    } catch (e) {
      console.error('Failed to load orgs', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  return (
    <OrgContext.Provider value={{ orgs, activeOrg, setActiveOrg, loading, refresh }}>
      {children}
    </OrgContext.Provider>
  );
}

export const useOrg = () => useContext(OrgContext);
