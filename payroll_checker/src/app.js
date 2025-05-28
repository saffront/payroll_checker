import React, { useState, useEffect } from 'react';
import { Upload, AlertTriangle, TrendingUp, TrendingDown, FileText, Users, DollarSign, X, Calendar } from 'lucide-react';
import * as XLSX from 'xlsx';

const PayrollMonitor = () => {
  const [historicalData, setHistoricalData] = useState({});
  const [alerts, setAlerts] = useState([]);
  const [summaryStats, setSummaryStats] = useState({});
  const [selectedThreshold, setSelectedThreshold] = useState(15);
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);

  const parsePayrollFile = async (file) => {
    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, {
      cellStyles: true,
      cellFormulas: true,
      cellDates: true,
      cellNF: true,
      sheetStubs: true
    });

    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const jsonData = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });
    
    // Extract month/year from the report title (Row 2)
    const reportTitle = jsonData[2] ? jsonData[2][0] : '';
    const monthMatch = reportTitle.match(/\[(.*?)-\s*(\d{4})\]/);
    let month = 'Unknown';
    if (monthMatch) {
      month = `${monthMatch[1].trim()} ${monthMatch[2]}`;
    } else {
      // Fallback: try to extract from filename
      const fileMatch = file.name.match(/(\d{2})(\d{2})(\d{2})/);
      if (fileMatch) {
        const day = fileMatch[1];
        const monthNum = fileMatch[2];
        const year = `20${fileMatch[3]}`;
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        month = `${monthNames[parseInt(monthNum) - 1]} ${year}`;
      }
    }
    
    // Headers are in row 6, data starts from row 8
    const headers = jsonData[6];
    const employees = [];
    
    for (let i = 8; i < jsonData.length; i++) {
      const row = jsonData[i];
      if (row && row.length > 0 && row[0] !== null && row[0] !== undefined) {
        const record = {};
        headers.forEach((header, index) => {
          if (header && row[index] !== undefined) {
            record[header] = row[index];
          }
        });
        employees.push(record);
      }
    }

    return { month, employees, fileName: file.name };
  };

  const handleMultipleFileUpload = async (event) => {
    const files = Array.from(event.target.files);
    if (files.length === 0) return;

    setIsProcessing(true);
    const newHistoricalData = { ...historicalData };
    const newUploadedFiles = [...uploadedFiles];

    try {
      for (const file of files) {
        const { month, employees, fileName } = await parsePayrollFile(file);
        newHistoricalData[month] = employees;
        
        // Add to uploaded files list if not already there
        if (!newUploadedFiles.find(f => f.month === month)) {
          newUploadedFiles.push({ month, fileName, employeeCount: employees.length });
        }
      }

      setHistoricalData(newHistoricalData);
      setUploadedFiles(newUploadedFiles.sort((a, b) => a.month.localeCompare(b.month)));
      
      // Calculate summary for the most recent month
      const months = Object.keys(newHistoricalData).sort();
      if (months.length > 0) {
        const latestMonth = months[months.length - 1];
        calculateSummaryStats(newHistoricalData[latestMonth]);
      }
      
      // Generate alerts
      generateAlerts(newHistoricalData);
      
    } catch (error) {
      alert('Error processing files: ' + error.message);
    }
    
    setIsProcessing(false);
    // Clear the input
    event.target.value = '';
  };

  const removeFile = (monthToRemove) => {
    const newHistoricalData = { ...historicalData };
    delete newHistoricalData[monthToRemove];
    setHistoricalData(newHistoricalData);
    
    const newUploadedFiles = uploadedFiles.filter(f => f.month !== monthToRemove);
    setUploadedFiles(newUploadedFiles);
    
    // Recalculate everything
    const months = Object.keys(newHistoricalData).sort();
    if (months.length > 0) {
      const latestMonth = months[months.length - 1];
      calculateSummaryStats(newHistoricalData[latestMonth]);
      generateAlerts(newHistoricalData);
    } else {
      setSummaryStats({});
      setAlerts([]);
    }
  };

  const calculateSummaryStats = (employees) => {
    const keyMetrics = ['Tot. Sal', 'Add', 'OT Amt', 'Gross', 'NettWgs', 'PCB'];
    const stats = {};

    keyMetrics.forEach(metric => {
      const values = employees
        .map(emp => emp[metric])
        .filter(val => val != null && !isNaN(val) && val !== 0);
      
      if (values.length > 0) {
        const total = values.reduce((sum, val) => sum + val, 0);
        const avg = total / values.length;
        const min = Math.min(...values);
        const max = Math.max(...values);
        stats[metric] = { total, avg, min, max, count: values.length };
      }
    });

    setSummaryStats(stats);
  };

  const generateAlerts = (allData) => {
    const months = Object.keys(allData).sort();
    if (months.length < 2) {
      setAlerts([]);
      return;
    }

    const alerts = [];
    const keyMetrics = ['Tot. Sal', 'Add', 'Gross', 'NettWgs', 'OT Amt'];

    // Compare each consecutive pair of months
    for (let i = 1; i < months.length; i++) {
      const currentMonth = months[i];
      const previousMonth = months[i - 1];
      const currentData = allData[currentMonth];
      const previousData = allData[previousMonth];

      // Company-wide metrics comparison
      keyMetrics.forEach(metric => {
        const currentTotal = currentData.reduce((sum, emp) => sum + (emp[metric] || 0), 0);
        const previousTotal = previousData.reduce((sum, emp) => sum + (emp[metric] || 0), 0);
        
        if (previousTotal > 0) {
          const variance = ((currentTotal - previousTotal) / previousTotal) * 100;
          
          if (Math.abs(variance) >= selectedThreshold) {
            alerts.push({
              type: 'company',
              severity: Math.abs(variance) >= 25 ? 'high' : 'medium',
              metric,
              variance: variance.toFixed(1),
              current: currentTotal.toFixed(2),
              previous: previousTotal.toFixed(2),
              currentMonth,
              previousMonth,
              message: `${metric} changed by ${variance.toFixed(1)}% from ${previousMonth} to ${currentMonth}`
            });
          }
        }
      });

      // Individual employee variance analysis
      currentData.forEach(currentEmp => {
        const previousEmp = previousData.find(emp => emp.Code === currentEmp.Code);
        if (!previousEmp) return;

        keyMetrics.forEach(metric => {
          const currentVal = currentEmp[metric] || 0;
          const previousVal = previousEmp[metric] || 0;
          
          // Enhanced logic to catch all significant changes
          const shouldCheck = (previousVal > 0 || currentVal > 0) && 
                             (Math.abs(currentVal - previousVal) > 500 || 
                              (previousVal > 0 && Math.abs((currentVal - previousVal) / previousVal * 100) >= selectedThreshold));
          
          if (shouldCheck) {
            let variance;
            let alertMessage;
            
            if (previousVal === 0 && currentVal > 0) {
              variance = 999;
              alertMessage = `${currentEmp['Emp. Name']} (${currentEmp.Code}) - ${metric} ADDED (${currentMonth})`;
            } else if (previousVal > 0 && currentVal === 0) {
              variance = -999;
              alertMessage = `${currentEmp['Emp. Name']} (${currentEmp.Code}) - ${metric} REMOVED (${currentMonth})`;
            } else if (previousVal > 0) {
              variance = ((currentVal - previousVal) / previousVal) * 100;
              alertMessage = `${currentEmp['Emp. Name']} (${currentEmp.Code}) - ${metric} changed by ${variance.toFixed(1)}% (${previousMonth} → ${currentMonth})`;
            } else {
              return;
            }

            if (Math.abs(variance) >= selectedThreshold || Math.abs(variance) >= 999) {
              alerts.push({
                type: 'employee',
                severity: Math.abs(variance) >= 50 || Math.abs(variance) >= 999 ? 'high' : 'medium',
                employee: currentEmp['Emp. Name'],
                code: currentEmp.Code,
                metric,
                variance: variance === 999 ? 'NEW' : variance === -999 ? 'REMOVED' : variance.toFixed(1),
                current: currentVal.toFixed(2),
                previous: previousVal.toFixed(2),
                currentMonth,
                previousMonth,
                message: alertMessage
              });
            }
          }
        });
      });

      // Employee count changes
      const empCountChange = currentData.length - previousData.length;
      if (empCountChange !== 0) {
        alerts.push({
          type: 'headcount',
          severity: Math.abs(empCountChange) >= 5 ? 'high' : 'medium',
          message: `Employee count changed by ${empCountChange > 0 ? '+' : ''}${empCountChange} from ${previousMonth} to ${currentMonth} (${previousData.length} → ${currentData.length})`,
          current: currentData.length,
          previous: previousData.length,
          currentMonth,
          previousMonth
        });
      }
    }

    // Sort alerts: high priority first, then by most recent month
    alerts.sort((a, b) => {
      if (a.severity === 'high' && b.severity !== 'high') return -1;
      if (b.severity === 'high' && a.severity !== 'high') return 1;
      return (b.currentMonth || '').localeCompare(a.currentMonth || '');
    });

    setAlerts(alerts);
  };

  // Recalculate alerts when threshold changes
  useEffect(() => {
    if (Object.keys(historicalData).length >= 2) {
      generateAlerts(historicalData);
    }
  }, [selectedThreshold]);

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-MY', { 
      style: 'currency', 
      currency: 'MYR',
      minimumFractionDigits: 2 
    }).format(amount);
  };

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'high': return 'text-red-600 bg-red-50 border-red-200';
      case 'medium': return 'text-orange-600 bg-orange-50 border-orange-200';
      default: return 'text-blue-600 bg-blue-50 border-blue-200';
    }
  };

  const getSeverityIcon = (severity) => {
    return severity === 'high' ? '🚨' : '⚠️';
  };

  return (
    <div className="max-w-7xl mx-auto p-6 bg-gray-50 min-h-screen">
      <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
        <h1 className="text-3xl font-bold text-gray-800 mb-2 flex items-center gap-3">
          <FileText className="text-blue-600" />
          Monthly Payroll Variance Monitor
        </h1>
        <p className="text-gray-600 mb-6">Upload multiple monthly payroll files to detect significant variations and flag items for review</p>
        
        <div className="flex flex-wrap items-center gap-4 mb-6">
          <label className={`flex items-center gap-2 px-4 py-2 rounded-lg cursor-pointer transition-colors ${
            isProcessing 
              ? 'bg-gray-400 text-white cursor-not-allowed' 
              : 'bg-blue-600 text-white hover:bg-blue-700'
          }`}>
            <Upload size={20} />
            {isProcessing ? 'Processing...' : 'Upload Payroll Files'}
            <input
              type="file"
              accept=".xls,.xlsx"
              multiple
              onChange={handleMultipleFileUpload}
              disabled={isProcessing}
              className="hidden"
            />
          </label>
          
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-700">Alert Threshold:</label>
            <select
              value={selectedThreshold}
              onChange={(e) => setSelectedThreshold(Number(e.target.value))}
              className="px-3 py-1 border border-gray-300 rounded-md text-sm"
            >
              <option value={10}>10%</option>
              <option value={15}>15%</option>
              <option value={20}>20%</option>
              <option value={25}>25%</option>
            </select>
          </div>

          <div className="text-sm text-gray-500">
            💡 You can upload multiple files at once or add files over time
          </div>
        </div>

        {uploadedFiles.length > 0 && (
          <div className="mb-6">
            <h3 className="text-lg font-medium text-gray-800 mb-3">Uploaded Files ({uploadedFiles.length})</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {uploadedFiles.map((file, index) => (
                <div key={index} className="bg-gray-50 p-3 rounded-lg flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <Calendar size={16} className="text-blue-600" />
                      <span className="font-medium text-gray-800">{file.month}</span>
                    </div>
                    <div className="text-sm text-gray-600">{file.employeeCount} employees</div>
                    <div className="text-xs text-gray-500">{file.fileName}</div>
                  </div>
                  <button
                    onClick={() => removeFile(file.month)}
                    className="text-red-500 hover:text-red-700 p-1"
                    title="Remove this file"
                  >
                    <X size={16} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {Object.keys(historicalData).length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="bg-blue-50 p-4 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <FileText className="text-blue-600" size={20} />
                <span className="font-medium text-blue-800">Months Loaded</span>
              </div>
              <div className="text-2xl font-bold text-blue-600">{Object.keys(historicalData).length}</div>
              <div className="text-sm text-blue-600">{Object.keys(historicalData).sort().join(', ')}</div>
            </div>
            
            <div className="bg-green-50 p-4 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <Users className="text-green-600" size={20} />
                <span className="font-medium text-green-800">Latest Month Employees</span>
              </div>
              <div className="text-2xl font-bold text-green-600">
                {(() => {
                  const months = Object.keys(historicalData).sort();
                  return months.length > 0 ? historicalData[months[months.length - 1]].length : 0;
                })()}
              </div>
            </div>
            
            <div className="bg-purple-50 p-4 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <DollarSign className="text-purple-600" size={20} />
                <span className="font-medium text-purple-800">Total Gross Pay</span>
              </div>
              <div className="text-2xl font-bold text-purple-600">
                {summaryStats.Gross ? formatCurrency(summaryStats.Gross.total) : 'N/A'}
              </div>
            </div>
          </div>
        )}
      </div>

      {alerts.length > 0 && (
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <h2 className="text-2xl font-bold text-gray-800 mb-4 flex items-center gap-2">
            <AlertTriangle className="text-orange-600" />
            Variance Alerts ({alerts.length})
          </h2>
          
          <div className="space-y-3">
            {alerts.map((alert, index) => (
              <div
                key={index}
                className={`p-4 rounded-lg border ${getSeverityColor(alert.severity)}`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-lg">{getSeverityIcon(alert.severity)}</span>
                      <span className="font-medium capitalize">{alert.type} Alert</span>
                      {alert.severity === 'high' && (
                        <span className="bg-red-600 text-white px-2 py-1 rounded-full text-xs font-medium">
                          HIGH PRIORITY
                        </span>
                      )}
                    </div>
                    <p className="text-sm mb-2 font-medium">{alert.message}</p>
                    {alert.current && alert.previous && (
                      <div className="text-xs space-y-1">
                        <div>Previous: {formatCurrency(alert.previous)}</div>
                        <div>Current: {formatCurrency(alert.current)}</div>
                        <div className="flex items-center gap-1">
                          {alert.variance !== 'NEW' && alert.variance !== 'REMOVED' && (
                            <>
                              {parseFloat(alert.variance) > 0 ? (
                                <TrendingUp size={16} className="text-green-600" />
                              ) : (
                                <TrendingDown size={16} className="text-red-600" />
                              )}
                              <span className="font-medium">{alert.variance}% change</span>
                            </>
                          )}
                          {(alert.variance === 'NEW' || alert.variance === 'REMOVED') && (
                            <span className="font-medium text-red-600">{alert.variance}</span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {Object.keys(summaryStats).length > 0 && (
        <div className="bg-white rounded-lg shadow-lg p-6">
          <h2 className="text-2xl font-bold text-gray-800 mb-4">Latest Month Summary</h2>
          
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-3 px-4 font-medium text-gray-700">Metric</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-700">Total</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-700">Average</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-700">Range</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-700">Employees</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(summaryStats).map(([metric, stats]) => (
                  <tr key={metric} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-3 px-4 font-medium">{metric}</td>
                    <td className="py-3 px-4 text-right">{formatCurrency(stats.total)}</td>
                    <td className="py-3 px-4 text-right">{formatCurrency(stats.avg)}</td>
                    <td className="py-3 px-4 text-right text-sm">
                      {formatCurrency(stats.min)} - {formatCurrency(stats.max)}
                    </td>
                    <td className="py-3 px-4 text-right">{stats.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {Object.keys(historicalData).length === 0 && (
        <div className="bg-white rounded-lg shadow-lg p-6 text-center">
          <Upload size={48} className="mx-auto text-gray-400 mb-4" />
          <h3 className="text-xl font-medium text-gray-700 mb-2">No Payroll Data Yet</h3>
          <p className="text-gray-500 mb-4">
            Upload your payroll files to begin monitoring month-to-month variations
          </p>
          <p className="text-sm text-gray-400">
            Supported formats: .xls, .xlsx • Multiple files supported
          </p>
        </div>
      )}
      
      <div className="mt-8 text-center text-sm text-gray-500">
        <p>🔒 All file processing happens locally in your browser. No data is sent to any server.</p>
      </div>
    </div>
  );
};

function App() {
  return (
    <div className="App">
      <PayrollMonitor />
    </div>
  );
}

export default App;
