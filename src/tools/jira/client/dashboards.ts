import { JiraClientCore } from "./core";

export interface ListDashboardsParams {
  filter?: string;
  startAt?: number;
  maxResults?: number;
}

export interface SearchDashboardsParams {
  filter?: string;
  startAt?: number;
  maxResults?: number;
}

export class JiraDashboards extends JiraClientCore {
  public async listDashboards(params: ListDashboardsParams = {}): Promise<any> {
    const searchParams = new URLSearchParams();
    if (params.filter) searchParams.set("filter", params.filter);
    if (params.startAt !== undefined) searchParams.set("startAt", String(params.startAt));
    if (params.maxResults !== undefined) searchParams.set("maxResults", String(params.maxResults));
    const suffix = searchParams.toString() ? `?${searchParams.toString()}` : "";
    return this.makeRequest<any>(`/rest/api/3/dashboard${suffix}`);
  }

  public async getDashboard(id: string): Promise<any> {
    return this.makeRequest<any>(`/rest/api/3/dashboard/${id}`);
  }

  public async createDashboard(payload: Record<string, any>): Promise<any> {
    return this.makeRequest<any>(`/rest/api/3/dashboard`, "POST", payload);
  }

  public async updateDashboard(id: string, payload: Record<string, any>): Promise<any> {
    return this.makeRequest<any>(`/rest/api/3/dashboard/${id}`, "PUT", payload);
  }

  public async deleteDashboard(id: string): Promise<void> {
    return this.makeRequest<void>(`/rest/api/3/dashboard/${id}`, "DELETE");
  }

  public async searchDashboards(params: SearchDashboardsParams = {}): Promise<any> {
    const searchParams = new URLSearchParams();
    if (params.filter) searchParams.set("filter", params.filter);
    if (params.startAt !== undefined) searchParams.set("startAt", String(params.startAt));
    if (params.maxResults !== undefined) searchParams.set("maxResults", String(params.maxResults));
    const suffix = searchParams.toString() ? `?${searchParams.toString()}` : "";
    return this.makeRequest<any>(`/rest/api/3/dashboard/search${suffix}`);
  }

  public async getAvailableGadgets(): Promise<any> {
    return this.makeRequest<any>(`/rest/api/3/dashboard/gadgets`);
  }

  public async getGadgets(dashboardId: string): Promise<any> {
    return this.makeRequest<any>(`/rest/api/3/dashboard/${dashboardId}/gadget`);
  }

  public async addGadget(dashboardId: string, payload: Record<string, any>): Promise<any> {
    return this.makeRequest<any>(`/rest/api/3/dashboard/${dashboardId}/gadget`, "POST", payload);
  }

  public async updateGadget(dashboardId: string, gadgetId: string, payload: Record<string, any>): Promise<any> {
    return this.makeRequest<any>(`/rest/api/3/dashboard/${dashboardId}/gadget/${gadgetId}`, "PUT", payload);
  }

  public async removeGadget(dashboardId: string, gadgetId: string): Promise<void> {
    return this.makeRequest<void>(`/rest/api/3/dashboard/${dashboardId}/gadget/${gadgetId}`, "DELETE");
  }

  public async getDashboardItemPropertyKeys(dashboardId: string, itemId: string): Promise<any> {
    return this.makeRequest<any>(`/rest/api/3/dashboard/${dashboardId}/items/${itemId}/properties`);
  }

  public async getDashboardItemProperty(dashboardId: string, itemId: string, propertyKey: string): Promise<any> {
    return this.makeRequest<any>(`/rest/api/3/dashboard/${dashboardId}/items/${itemId}/properties/${propertyKey}`);
  }

  public async setDashboardItemProperty(
    dashboardId: string,
    itemId: string,
    propertyKey: string,
    value: Record<string, any>,
  ): Promise<any> {
    return this.makeRequest<any>(
      `/rest/api/3/dashboard/${dashboardId}/items/${itemId}/properties/${propertyKey}`,
      "PUT",
      value,
    );
  }

  public async deleteDashboardItemProperty(dashboardId: string, itemId: string, propertyKey: string): Promise<void> {
    return this.makeRequest<void>(`/rest/api/3/dashboard/${dashboardId}/items/${itemId}/properties/${propertyKey}`, "DELETE");
  }

  public async copyDashboard(id: string, payload: Record<string, any>, extendAdminPermissions?: boolean): Promise<any> {
    const searchParams = new URLSearchParams();
    if (extendAdminPermissions !== undefined) searchParams.set("extendAdminPermissions", String(extendAdminPermissions));
    const suffix = searchParams.toString() ? `?${searchParams.toString()}` : "";
    return this.makeRequest<any>(`/rest/api/3/dashboard/${id}/copy${suffix}`, "POST", payload);
  }
}


