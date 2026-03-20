import { describe, it, expect } from 'vitest';

// Test API Response transformation logic
describe('API Response Transformation', () => {
  // Helper to simulate API response extraction
  interface ApiResponse<T> {
    data: T;
  }

  interface PaginatedApiResponse<T> {
    data: T[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      pages: number;
    };
  }

  interface PaginatedResponse<T> {
    data: T[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }

  it('should extract data from simple API response', () => {
    const apiResponse: ApiResponse<{ id: string; name: string }> = {
      data: { id: '1', name: 'Test Room' },
    };

    // Simulating: response.data.data
    const result = apiResponse.data;

    expect(result).toEqual({ id: '1', name: 'Test Room' });
  });

  it('should extract array data from API response', () => {
    const apiResponse: ApiResponse<Array<{ id: string; name: string }>> = {
      data: [
        { id: '1', name: 'Room 1' },
        { id: '2', name: 'Room 2' },
      ],
    };

    const result = apiResponse.data;

    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('Room 1');
  });

  it('should transform paginated response correctly', () => {
    const apiResponse: PaginatedApiResponse<{ id: string; hostname: string }> = {
      data: [
        { id: '1', hostname: 'pc-01' },
        { id: '2', hostname: 'pc-02' },
      ],
      pagination: {
        page: 1,
        limit: 25,
        total: 50,
        pages: 2,
      },
    };

    // Transformation logic from hosts.ts/operations.ts
    const result: PaginatedResponse<{ id: string; hostname: string }> = {
      data: apiResponse.data,
      total: apiResponse.pagination.total,
      page: apiResponse.pagination.page,
      limit: apiResponse.pagination.limit,
      totalPages: apiResponse.pagination.pages,
    };

    expect(result.data).toHaveLength(2);
    expect(result.total).toBe(50);
    expect(result.page).toBe(1);
    expect(result.limit).toBe(25);
    expect(result.totalPages).toBe(2);
  });

  it('should handle empty paginated response', () => {
    const apiResponse: PaginatedApiResponse<{ id: string }> = {
      data: [],
      pagination: {
        page: 1,
        limit: 25,
        total: 0,
        pages: 0,
      },
    };

    const result: PaginatedResponse<{ id: string }> = {
      data: apiResponse.data,
      total: apiResponse.pagination.total,
      page: apiResponse.pagination.page,
      limit: apiResponse.pagination.limit,
      totalPages: apiResponse.pagination.pages,
    };

    expect(result.data).toHaveLength(0);
    expect(result.total).toBe(0);
    expect(result.totalPages).toBe(0);
  });

  it('should handle nested data extraction for preview endpoint', () => {
    // configs/:id/preview returns { data: { content: string } }
    const apiResponse: ApiResponse<{ content: string }> = {
      data: { content: '[LINBO]\nServer = 10.0.0.1\n' },
    };

    const result = apiResponse.data.content;

    expect(result).toContain('[LINBO]');
    expect(result).toContain('Server = 10.0.0.1');
  });
});
