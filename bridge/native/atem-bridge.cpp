#define _WIN32_WINNT 0x0A00

#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <objbase.h>
#include <oleauto.h>
#include <wrl/client.h>

#include <algorithm>
#include <atomic>
#include <cctype>
#include <cstdint>
#include <cstdlib>
#include <functional>
#include <map>
#include <mutex>
#include <sstream>
#include <string>
#include <vector>

#include "../../vendors/Windows/Samples/DeviceInfo/BMDSwitcherAPI.h"

#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "oleaut32.lib")
#pragma comment(lib, "ws2_32.lib")

using Microsoft::WRL::ComPtr;

namespace
{
	constexpr int kDefaultPort = 4011;
	const wchar_t* kDiscoveryClsids[] = {
		L"{3EFEA8DB-282F-4C23-B218-FC8A2FF0861E}",
		L"{B8C0BA7E-BDED-4B73-96A8-266AF1BC2D7A}",
		L"{80FE9CCE-1DC9-4BA7-A45A-8297A04F0350}",
		L"{4DB07DF8-72BE-4C0D-BBE6-03B9DFF59B3C}",
		L"{ACB00FD2-ABE1-467F-A2D5-5D77001815D1}",
		L"{9119E903-A6D0-4C05-80EF-C322D654D6DD}",
		L"{449345CB-64CE-4DF0-AFEE-18C60A0ABE46}",
		L"{F73F3A7A-9406-4A77-8601-E60CCA5066CB}",
		L"{BA726CE9-B8F5-4B1B-AA00-1A2DF3998B45}",
		L"{49895038-FB6D-4AF7-A637-7A92F09F8655}",
		L"{C9F0A63F-69C5-40FD-84F6-A8632B0D65D6}",
		L"{F2DC5149-9599-47E4-84B9-054C78A1A46D}"
	};

	struct InputInfo
	{
		long long id = 0;
		std::string label;
	};

	struct State
	{
		bool bridgeAvailable = true;
		std::string bridgeMode = "sdk";
		bool connected = false;
		std::string switcherIp;
		std::vector<InputInfo> inputs;
		long long previewInput = 0;
		long long programInput = 0;
		bool isRecording = false;
		std::string filename;
		std::string recordingStatus = "disconnected";
		bool output4Supported = false;
		std::string output4Mode = "multiview";
		std::string lastError;
		std::string lastCommandAt;
	};


	enum class SwitcherApiVersion
	{
		none,
		base,
		v10_1_1,
		v9_8_3,
		v9_6_3
	};

	std::mutex gMutex;
	State gState;
	SwitcherApiVersion gSwitcherApiVersion = SwitcherApiVersion::none;
	ComPtr<IBMDSwitcher> gSwitcher;
	ComPtr<IBMDSwitcher_v10_1_1> gSwitcher1011;
	ComPtr<IBMDSwitcher_v9_8_3> gSwitcher983;
	ComPtr<IBMDSwitcher_v9_6_3> gSwitcher963;
	ComPtr<IBMDSwitcherMixEffectBlock> gMixEffectBlock;
	ComPtr<IBMDSwitcherMixEffectBlock_v9_8_3> gMixEffectBlock983;
	ComPtr<IBMDSwitcherMixEffectBlock_v7_5> gMixEffectBlock75;
	ComPtr<IBMDSwitcherRecordAV> gRecordAv;
	ComPtr<IBMDSwitcherRecordAV_v9_0_1> gRecordAv901;
	ComPtr<IBMDSwitcherInputAux> gAuxOutput4;
	ComPtr<IBMDSwitcherInputAux_v9_8_3> gAuxOutput4983;
	long long gOutput4ProgramSourceId = 0;
	long long gOutput4MultiviewSourceId = 0;
	std::string gInputDiscoveryDebug;

	std::string nowIso()
	{
		SYSTEMTIME st {};
		GetLocalTime(&st);
		char buffer[64];
		snprintf(buffer, sizeof(buffer), "%04u-%02u-%02uT%02u:%02u:%02u",
			st.wYear, st.wMonth, st.wDay, st.wHour, st.wMinute, st.wSecond);
		return buffer;
	}



	void logMessage(const std::string& message)
	{
		char tempPath[MAX_PATH] = {};
		if (!GetTempPathA(MAX_PATH, tempPath))
			return;

		std::string logPath = std::string(tempPath) + "leaderslate-atem-bridge.log";
		HANDLE file = CreateFileA(logPath.c_str(), FILE_APPEND_DATA, FILE_SHARE_READ, nullptr, OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
		if (file == INVALID_HANDLE_VALUE)
			return;

		const std::string line = nowIso() + " " + message + "\r\n";
		DWORD written = 0;
		WriteFile(file, line.c_str(), static_cast<DWORD>(line.size()), &written, nullptr);
		CloseHandle(file);
	}	std::string formatHresult(HRESULT hr)
	{
		char buffer[32];
		snprintf(buffer, sizeof(buffer), "0x%08lX", static_cast<unsigned long>(hr));
		return buffer;
	}

	std::string connectFailReasonToString(BMDSwitcherConnectToFailure reason)
	{
		switch (reason)
		{
		case bmdSwitcherConnectToFailureNoResponse:
			return "No response from switcher";
		case bmdSwitcherConnectToFailureIncompatibleFirmware:
			return "Switcher firmware is incompatible";
		case bmdSwitcherConnectToFailureCorruptData:
			return "Switcher returned corrupt data";
		case bmdSwitcherConnectToFailureStateSync:
			return "Switcher state synchronization failed";
		case bmdSwitcherConnectToFailureStateSyncTimedOut:
			return "Switcher state synchronization timed out";
		default:
			return "Unknown connect failure";
		}
	}
	std::string recordAvErrorToString(BMDSwitcherRecordAVError error)
	{
		switch (error)
		{
		case bmdSwitcherRecordAVErrorNone:
			return std::string();
		case bmdSwitcherRecordAVErrorNoMedia:
			return "Recorder error: no media";
		case bmdSwitcherRecordAVErrorMediaFull:
			return "Recorder error: media full";
		case bmdSwitcherRecordAVErrorMediaError:
			return "Recorder error: media error";
		case bmdSwitcherRecordAVErrorMediaUnformatted:
			return "Recorder error: media unformatted";
		case bmdSwitcherRecordAVErrorDroppingFrames:
			return "Recorder error: dropping frames";
		case bmdSwitcherRecordAVErrorUnknown:
			return "Recorder error: unknown";
		default:
			return "Recorder error: unrecognized status";
		}
	}
	std::string portTypeToString(BMDSwitcherPortType type)
	{
		switch (type)
		{
		case bmdSwitcherPortTypeExternal: return "external";
		case bmdSwitcherPortTypeBlack: return "black";
		case bmdSwitcherPortTypeColorBars: return "colorbars";
		case bmdSwitcherPortTypeColorGenerator: return "colorgenerator";
		case bmdSwitcherPortTypeMediaPlayerFill: return "mediaplayerfill";
		case bmdSwitcherPortTypeMediaPlayerCut: return "mediaplayercut";
		case bmdSwitcherPortTypeSuperSource: return "supersource";
		case bmdSwitcherPortTypeMixEffectBlockOutput: return "mixeffectblockoutput";
		case bmdSwitcherPortTypeAuxOutput: return "auxoutput";
		case bmdSwitcherPortTypeKeyCutOutput: return "keycutoutput";
		case bmdSwitcherPortTypeMultiview: return "multiview";
		case bmdSwitcherPortTypeAudioMonitor: return "audiomonitor";
		case bmdSwitcherPortTypeExternalDirect: return "externaldirect";
		default: return "unknown";
		}
	}
	std::wstring widen(const std::string& value)
	{
		if (value.empty())
			return std::wstring();
		int size = MultiByteToWideChar(CP_UTF8, 0, value.c_str(), -1, nullptr, 0);
		if (size <= 0)
			return std::wstring();
		std::wstring out(size - 1, L'\0');
		MultiByteToWideChar(CP_UTF8, 0, value.c_str(), -1, out.data(), size);
		return out;
	}

	std::string narrow(const std::wstring& value)
	{
		if (value.empty())
			return std::string();
		int size = WideCharToMultiByte(CP_UTF8, 0, value.c_str(), -1, nullptr, 0, nullptr, nullptr);
		if (size <= 0)
			return std::string();
		std::string out(size - 1, '\0');
		WideCharToMultiByte(CP_UTF8, 0, value.c_str(), -1, out.data(), size, nullptr, nullptr);
		return out;
	}

	std::string bstrToUtf8(BSTR value)
	{
		if (!value)
			return std::string();
		return narrow(std::wstring(value, SysStringLen(value)));
	}

	std::string jsonEscape(const std::string& value)
	{
		std::ostringstream out;
		for (char ch : value)
		{
			switch (ch)
			{
			case '\\': out << "\\\\"; break;
			case '"': out << "\\\""; break;
			case '\n': out << "\\n"; break;
			case '\r': out << "\\r"; break;
			case '\t': out << "\\t"; break;
			default:
				if (static_cast<unsigned char>(ch) < 0x20)
				{
					char buf[7];
					snprintf(buf, sizeof(buf), "\\u%04x", ch & 0xff);
					out << buf;
				}
				else
				{
					out << ch;
				}
			}
		}
		return out.str();
	}

	std::string boolToString(bool value)
	{
		return value ? "true" : "false";
	}

	std::string stateJsonLocked()
	{
		std::ostringstream out;
		out << "{";
		out << "\"bridgeAvailable\":" << (gState.bridgeAvailable ? "true" : "false") << ",";
		out << "\"bridgeMode\":\"" << jsonEscape(gState.bridgeMode) << "\",";
		out << "\"connected\":" << (gState.connected ? "true" : "false") << ",";
		out << "\"switcherIp\":\"" << jsonEscape(gState.switcherIp) << "\",";
		out << "\"inputs\":[";
		for (size_t i = 0; i < gState.inputs.size(); ++i)
		{
			if (i) out << ",";
			out << "{\"id\":" << gState.inputs[i].id << ",\"label\":\"" << jsonEscape(gState.inputs[i].label) << "\"}";
		}
		out << "],";
		out << "\"previewInput\":" << gState.previewInput << ",";
		out << "\"programInput\":" << gState.programInput << ",";
		out << "\"recording\":{";
		out << "\"isRecording\":" << (gState.isRecording ? "true" : "false") << ",";
		out << "\"filename\":\"" << jsonEscape(gState.filename) << "\",";
		out << "\"status\":\"" << jsonEscape(gState.recordingStatus) << "\"";
		out << "},";
		out << "\"output4\":{";
		out << "\"supported\":" << (gState.output4Supported ? "true" : "false") << ",";
		out << "\"mode\":\"" << jsonEscape(gState.output4Mode) << "\"";
		out << "},";
		out << "\"lastError\":\"" << jsonEscape(gState.lastError) << "\",";
		out << "\"lastCommandAt\":\"" << jsonEscape(gState.lastCommandAt) << "\"";
		out << "}";
		return out.str();
	}

	std::string jsonErrorLocked(const std::string& message)
	{
		std::ostringstream out;
		out << "{\"error\":\"" << jsonEscape(message) << "\",\"state\":" << stateJsonLocked() << "}";
		return out.str();
	}

	void clearConnectionLocked()
	{
		gSwitcherApiVersion = SwitcherApiVersion::none;
		gRecordAv901.Reset();
		gRecordAv.Reset();
		gAuxOutput4983.Reset();
		gAuxOutput4.Reset();
		gMixEffectBlock75.Reset();
		gMixEffectBlock983.Reset();
		gMixEffectBlock.Reset();
		gSwitcher963.Reset();
		gSwitcher983.Reset();
		gSwitcher1011.Reset();
		gSwitcher.Reset();
		gState.connected = false;
		gState.inputs.clear();
		gState.previewInput = 0;
		gState.programInput = 0;
		gState.isRecording = false;
		gState.filename.clear();
		gState.recordingStatus = "disconnected";
		gState.output4Supported = false;
		gState.output4Mode = "multiview";
		gOutput4ProgramSourceId = 0;
		gOutput4MultiviewSourceId = 0;
	}

	bool hasActiveSwitcherLocked()
	{
		switch (gSwitcherApiVersion)
		{
		case SwitcherApiVersion::base:
			return gSwitcher != nullptr;
		case SwitcherApiVersion::v10_1_1:
			return gSwitcher1011 != nullptr;
		case SwitcherApiVersion::v9_8_3:
			return gSwitcher983 != nullptr;
		case SwitcherApiVersion::v9_6_3:
			return gSwitcher963 != nullptr;
		default:
			return false;
		}
	}

	HRESULT createIteratorLocked(REFIID iid, void** outIterator)
	{
		if (!outIterator)
			return E_POINTER;
		*outIterator = nullptr;

		switch (gSwitcherApiVersion)
		{
		case SwitcherApiVersion::base:
			return gSwitcher ? gSwitcher->CreateIterator(iid, outIterator) : E_POINTER;
		case SwitcherApiVersion::v10_1_1:
			return gSwitcher1011 ? gSwitcher1011->CreateIterator(iid, outIterator) : E_POINTER;
		case SwitcherApiVersion::v9_8_3:
			return gSwitcher983 ? gSwitcher983->CreateIterator(iid, outIterator) : E_POINTER;
		case SwitcherApiVersion::v9_6_3:
			return gSwitcher963 ? gSwitcher963->CreateIterator(iid, outIterator) : E_POINTER;
		default:
			return E_POINTER;
		}
	}

	template <typename TInterface>
	bool queryActiveSwitcherLocked(ComPtr<TInterface>& target)
	{
		target.Reset();
		switch (gSwitcherApiVersion)
		{
		case SwitcherApiVersion::base:
			return gSwitcher && SUCCEEDED(gSwitcher.As(&target)) && target;
		case SwitcherApiVersion::v10_1_1:
			return gSwitcher1011 && SUCCEEDED(gSwitcher1011.As(&target)) && target;
		case SwitcherApiVersion::v9_8_3:
			return gSwitcher983 && SUCCEEDED(gSwitcher983.As(&target)) && target;
		case SwitcherApiVersion::v9_6_3:
			return gSwitcher963 && SUCCEEDED(gSwitcher963.As(&target)) && target;
		default:
			return false;
		}
	}

	bool refreshInputsLocked()
	{
		gState.inputs.clear();
		gState.output4Supported = false;
		gState.output4Mode = "multiview";
		gAuxOutput4.Reset();
		gAuxOutput4983.Reset();
		gOutput4ProgramSourceId = 0;
		gOutput4MultiviewSourceId = 0;
		gInputDiscoveryDebug.clear();
		if (!hasActiveSwitcherLocked())
			return false;

		int auxOutputCount = 0;
		long long output4InputId = 0;

		ComPtr<IBMDSwitcherInputIterator> iterator;
		if (SUCCEEDED(createIteratorLocked(__uuidof(IBMDSwitcherInputIterator), reinterpret_cast<void**>(iterator.GetAddressOf()))) && iterator)
		{
			while (true)
			{
				ComPtr<IBMDSwitcherInput> input;
				if (iterator->Next(input.GetAddressOf()) != S_OK)
					break;

				BMDSwitcherInputId id = 0;
				BSTR longName = nullptr;
				if (FAILED(input->GetInputId(&id)))
					continue;
				if (FAILED(input->GetLongName(&longName)))
					continue;

				gState.inputs.push_back({ static_cast<long long>(id), bstrToUtf8(longName) });
				SysFreeString(longName);

				BMDSwitcherPortType portType = bmdSwitcherPortTypeExternal;
				if (SUCCEEDED(input->GetPortType(&portType)))
				{
					if (!gOutput4ProgramSourceId && (portType == bmdSwitcherPortTypeMixEffectBlockOutput || gState.inputs.back().label == "Program" || static_cast<long long>(id) == 10010))
						gOutput4ProgramSourceId = static_cast<long long>(id);
					if (!gOutput4MultiviewSourceId && (portType == bmdSwitcherPortTypeMultiview || gState.inputs.back().label == "Multi View" || static_cast<long long>(id) == 9001))
						gOutput4MultiviewSourceId = static_cast<long long>(id);
					if (!output4InputId && (gState.inputs.back().label == "Output 4" || static_cast<long long>(id) == 8004))
						output4InputId = static_cast<long long>(id);
				}

				BMDSwitcherInputAvailability inputAvailability = static_cast<BMDSwitcherInputAvailability>(0);
				const bool hasAvailability = SUCCEEDED(input->GetInputAvailability(&inputAvailability));
				ComPtr<IBMDSwitcherInputAux> inputAux;
				const HRESULT inputAuxHr = input.As(&inputAux);
				const bool isAux = SUCCEEDED(inputAuxHr) && inputAux;
				ComPtr<IBMDSwitcherInputAux_v9_8_3> inputAux983Compat;
				const HRESULT inputAux983Hr = input.As(&inputAux983Compat);
				const bool isAux983Compat = SUCCEEDED(inputAux983Hr) && inputAux983Compat;
				gInputDiscoveryDebug += "input discovered id=" + std::to_string(static_cast<long long>(id))
					+ " label=" + gState.inputs.back().label
					+ " portType=" + portTypeToString(portType)
					+ " availabilityKnown=" + boolToString(hasAvailability)
					+ " availability=" + std::to_string(static_cast<unsigned int>(inputAvailability))
					+ " auxBase=" + boolToString(isAux)
					+ " auxBaseHr=" + formatHresult(inputAuxHr)
					+ " aux983=" + boolToString(isAux983Compat)
					+ " aux983Hr=" + formatHresult(inputAux983Hr)
					+ "\n";
				if (isAux || isAux983Compat)
				{
					auxOutputCount += 1;
					BMDSwitcherInputId auxSource = 0;
					if (isAux && SUCCEEDED(inputAux->GetInputSource(&auxSource)))
						gInputDiscoveryDebug += "aux candidate index=" + std::to_string(auxOutputCount) + " id=" + std::to_string(static_cast<long long>(id)) + " iface=base currentSource=" + std::to_string(static_cast<long long>(auxSource)) + "\n";
					else if (isAux983Compat && SUCCEEDED(inputAux983Compat->GetInputSource(&auxSource)))
						gInputDiscoveryDebug += "aux candidate index=" + std::to_string(auxOutputCount) + " id=" + std::to_string(static_cast<long long>(id)) + " iface=v9_8_3 currentSource=" + std::to_string(static_cast<long long>(auxSource)) + "\n";
					if (static_cast<long long>(id) == output4InputId || gState.inputs.back().label == "Output 4")
					{
						if (isAux)
							gAuxOutput4 = inputAux;
						if (isAux983Compat)
							gAuxOutput4983 = inputAux983Compat;
						gInputDiscoveryDebug += "selected output 4 from base iterator id=" + std::to_string(static_cast<long long>(id))
							+ " selectedBase=" + boolToString(gAuxOutput4 != nullptr)
							+ " selected983=" + boolToString(gAuxOutput4983 != nullptr)
							+ "\n";
					}
					else if (auxOutputCount == 4 && !gAuxOutput4 && !gAuxOutput4983)
					{
						if (isAux)
							gAuxOutput4 = inputAux;
						if (isAux983Compat)
							gAuxOutput4983 = inputAux983Compat;
						gInputDiscoveryDebug += "fallback selected output 4 from base iterator id=" + std::to_string(static_cast<long long>(id))
							+ " selectedBase=" + boolToString(gAuxOutput4 != nullptr)
							+ " selected983=" + boolToString(gAuxOutput4983 != nullptr)
							+ "\n";
					}
				}
			}

			if ((gAuxOutput4 || gAuxOutput4983) && gOutput4ProgramSourceId && gOutput4MultiviewSourceId)
			{
				BMDSwitcherInputId inputSource = 0;
				if (gAuxOutput4 && SUCCEEDED(gAuxOutput4->GetInputSource(&inputSource)))
					gState.output4Mode = static_cast<long long>(inputSource) == gOutput4ProgramSourceId ? "program" : "multiview";
				else if (gAuxOutput4983 && SUCCEEDED(gAuxOutput4983->GetInputSource(&inputSource)))
					gState.output4Mode = static_cast<long long>(inputSource) == gOutput4ProgramSourceId ? "program" : "multiview";
				gState.output4Supported = true;
			}
			gInputDiscoveryDebug += "output4 summary base auxFound=" + boolToString(gAuxOutput4 != nullptr) + " aux983Found=" + boolToString(gAuxOutput4983 != nullptr) + " programSource=" + std::to_string(gOutput4ProgramSourceId) + " multiviewSource=" + std::to_string(gOutput4MultiviewSourceId) + " mode=" + gState.output4Mode + "\n";
			if (gState.output4Supported || gAuxOutput4 || gAuxOutput4983)
				return true;
			gInputDiscoveryDebug += "falling back to v9_6_1 iterator for output 4 probing\n";
			gState.inputs.clear();
			gOutput4ProgramSourceId = 0;
			gOutput4MultiviewSourceId = 0;
			auxOutputCount = 0;
			output4InputId = 0;
		}

		ComPtr<IBMDSwitcherInputIterator_v9_6_1> iterator961;
		if (FAILED(createIteratorLocked(__uuidof(IBMDSwitcherInputIterator_v9_6_1), reinterpret_cast<void**>(iterator961.GetAddressOf()))) || !iterator961)
			return false;

		while (true)
		{
			ComPtr<IBMDSwitcherInput_v9_6_1> input;
			if (iterator961->Next(input.GetAddressOf()) != S_OK)
				break;

			BMDSwitcherInputId id = 0;
			BSTR longName = nullptr;
			if (FAILED(input->GetInputId(&id)))
				continue;
			if (FAILED(input->GetLongName(&longName)))
				continue;

			gState.inputs.push_back({ static_cast<long long>(id), bstrToUtf8(longName) });
			SysFreeString(longName);

			BMDSwitcherPortType portType = bmdSwitcherPortTypeExternal;
			if (SUCCEEDED(input->GetPortType(&portType)))
			{
				if (!gOutput4ProgramSourceId && (portType == bmdSwitcherPortTypeMixEffectBlockOutput || gState.inputs.back().label == "Program" || static_cast<long long>(id) == 10010))
					gOutput4ProgramSourceId = static_cast<long long>(id);
				if (!gOutput4MultiviewSourceId && (portType == bmdSwitcherPortTypeMultiview || gState.inputs.back().label == "Multi View" || static_cast<long long>(id) == 9001))
					gOutput4MultiviewSourceId = static_cast<long long>(id);
				if (!output4InputId && (gState.inputs.back().label == "Output 4" || static_cast<long long>(id) == 8004))
					output4InputId = static_cast<long long>(id);
			}

			BMDSwitcherInputAvailability inputAvailability = static_cast<BMDSwitcherInputAvailability>(0);
			const bool hasAvailability = SUCCEEDED(input->GetInputAvailability(&inputAvailability));
			ComPtr<IBMDSwitcherInputAux_v9_8_3> inputAux983;
			const HRESULT inputAux983Hr = input.As(&inputAux983);
			const bool isAux983 = SUCCEEDED(inputAux983Hr) && inputAux983;
			ComPtr<IBMDSwitcherInputAux> inputAuxBaseCompat;
			const HRESULT inputAuxBaseHr = input.As(&inputAuxBaseCompat);
			const bool isAuxBaseCompat = SUCCEEDED(inputAuxBaseHr) && inputAuxBaseCompat;
			gInputDiscoveryDebug += "input discovered v9_6_1 id=" + std::to_string(static_cast<long long>(id))
				+ " label=" + gState.inputs.back().label
				+ " portType=" + portTypeToString(portType)
				+ " availabilityKnown=" + boolToString(hasAvailability)
				+ " availability=" + std::to_string(static_cast<unsigned int>(inputAvailability))
				+ " aux983=" + boolToString(isAux983)
				+ " aux983Hr=" + formatHresult(inputAux983Hr)
				+ " auxBase=" + boolToString(isAuxBaseCompat)
				+ " auxBaseHr=" + formatHresult(inputAuxBaseHr)
				+ "\n";
			if (isAux983 || isAuxBaseCompat)
			{
				auxOutputCount += 1;
				BMDSwitcherInputId auxSource = 0;
				if (isAux983 && SUCCEEDED(inputAux983->GetInputSource(&auxSource)))
					gInputDiscoveryDebug += "aux candidate v9_6_1 index=" + std::to_string(auxOutputCount) + " id=" + std::to_string(static_cast<long long>(id)) + " iface=v9_8_3 currentSource=" + std::to_string(static_cast<long long>(auxSource)) + "\n";
				else if (isAuxBaseCompat && SUCCEEDED(inputAuxBaseCompat->GetInputSource(&auxSource)))
					gInputDiscoveryDebug += "aux candidate v9_6_1 index=" + std::to_string(auxOutputCount) + " id=" + std::to_string(static_cast<long long>(id)) + " iface=base currentSource=" + std::to_string(static_cast<long long>(auxSource)) + "\n";
				if (static_cast<long long>(id) == output4InputId || gState.inputs.back().label == "Output 4")
				{
					if (isAux983)
						gAuxOutput4983 = inputAux983;
					if (isAuxBaseCompat)
						gAuxOutput4 = inputAuxBaseCompat;
					gInputDiscoveryDebug += "selected output 4 from v9_6_1 iterator id=" + std::to_string(static_cast<long long>(id))
						+ " selected983=" + boolToString(gAuxOutput4983 != nullptr)
						+ " selectedBase=" + boolToString(gAuxOutput4 != nullptr)
						+ "\n";
				}
				else if (auxOutputCount == 4 && !gAuxOutput4983 && !gAuxOutput4)
				{
					if (isAux983)
						gAuxOutput4983 = inputAux983;
					if (isAuxBaseCompat)
						gAuxOutput4 = inputAuxBaseCompat;
					gInputDiscoveryDebug += "fallback selected output 4 from v9_6_1 iterator id=" + std::to_string(static_cast<long long>(id))
						+ " selected983=" + boolToString(gAuxOutput4983 != nullptr)
						+ " selectedBase=" + boolToString(gAuxOutput4 != nullptr)
						+ "\n";
				}
			}
		}

		if ((gAuxOutput4983 || gAuxOutput4) && gOutput4ProgramSourceId && gOutput4MultiviewSourceId)
		{
			BMDSwitcherInputId inputSource = 0;
			if (gAuxOutput4983 && SUCCEEDED(gAuxOutput4983->GetInputSource(&inputSource)))
				gState.output4Mode = static_cast<long long>(inputSource) == gOutput4ProgramSourceId ? "program" : "multiview";
			else if (gAuxOutput4 && SUCCEEDED(gAuxOutput4->GetInputSource(&inputSource)))
				gState.output4Mode = static_cast<long long>(inputSource) == gOutput4ProgramSourceId ? "program" : "multiview";
			gState.output4Supported = true;
		}

		gInputDiscoveryDebug += "output4 summary v9_6_1 auxFound=" + boolToString(gAuxOutput4983 != nullptr) + " auxBaseFound=" + boolToString(gAuxOutput4 != nullptr) + " programSource=" + std::to_string(gOutput4ProgramSourceId) + " multiviewSource=" + std::to_string(gOutput4MultiviewSourceId) + " mode=" + gState.output4Mode + "\n";

		return true;
	}

	bool refreshMixEffectLocked()
	{
		gMixEffectBlock75.Reset();
		gMixEffectBlock983.Reset();
		gMixEffectBlock.Reset();
		if (!hasActiveSwitcherLocked())
			return false;

		ComPtr<IBMDSwitcherMixEffectBlockIterator> iterator;
		if (SUCCEEDED(createIteratorLocked(__uuidof(IBMDSwitcherMixEffectBlockIterator), reinterpret_cast<void**>(iterator.GetAddressOf()))) && iterator)
		{
			if (iterator->Next(gMixEffectBlock.GetAddressOf()) == S_OK && gMixEffectBlock)
			{
				BMDSwitcherInputId preview = 0;
				BMDSwitcherInputId program = 0;
				if (SUCCEEDED(gMixEffectBlock->GetPreviewInput(&preview)))
					gState.previewInput = static_cast<long long>(preview);
				if (SUCCEEDED(gMixEffectBlock->GetProgramInput(&program)))
					gState.programInput = static_cast<long long>(program);
				return true;
			}
		}

		ComPtr<IBMDSwitcherMixEffectBlockIterator_v9_8_3> iterator983;
		if (SUCCEEDED(createIteratorLocked(__uuidof(IBMDSwitcherMixEffectBlockIterator_v9_8_3), reinterpret_cast<void**>(iterator983.GetAddressOf()))) && iterator983)
		{
			if (iterator983->Next(gMixEffectBlock983.GetAddressOf()) == S_OK && gMixEffectBlock983)
			{
				BMDSwitcherInputId preview = 0;
				BMDSwitcherInputId program = 0;
				if (SUCCEEDED(gMixEffectBlock983->GetPreviewInput(&preview)))
					gState.previewInput = static_cast<long long>(preview);
				if (SUCCEEDED(gMixEffectBlock983->GetProgramInput(&program)))
					gState.programInput = static_cast<long long>(program);
				return true;
			}
		}

		ComPtr<IBMDSwitcherMixEffectBlockIterator_v7_5> iterator75;
		if (FAILED(createIteratorLocked(__uuidof(IBMDSwitcherMixEffectBlockIterator_v7_5), reinterpret_cast<void**>(iterator75.GetAddressOf()))) || !iterator75)
			return false;
		if (iterator75->Next(gMixEffectBlock75.GetAddressOf()) != S_OK || !gMixEffectBlock75)
			return false;

		LONGLONG preview = 0;
		LONGLONG program = 0;
		if (SUCCEEDED(gMixEffectBlock75->GetInt(bmdSwitcherMixEffectBlockPropertyIdPreviewInput_v7_5, &preview)))
			gState.previewInput = static_cast<long long>(preview);
		if (SUCCEEDED(gMixEffectBlock75->GetInt(bmdSwitcherMixEffectBlockPropertyIdProgramInput_v7_5, &program)))
			gState.programInput = static_cast<long long>(program);
		return true;
	}

	void refreshRecordStateLocked()
	{
		gRecordAv901.Reset();
		gRecordAv.Reset();
		if (!hasActiveSwitcherLocked())
		{
			gState.isRecording = false;
			gState.recordingStatus = "disconnected";
			return;
		}

		auto updateRecordState = [&](auto& recordInterface)
		{
			gState.lastError.clear();
			BOOL isRecording = FALSE;
			if (SUCCEEDED(recordInterface->IsRecording(&isRecording)))
				gState.isRecording = isRecording == TRUE;

			BSTR filename = nullptr;
			if (SUCCEEDED(recordInterface->GetFilename(&filename)))
			{
				gState.filename = bstrToUtf8(filename);
				SysFreeString(filename);
			}

			BMDSwitcherRecordAVState state = bmdSwitcherRecordAVStateIdle;
			BMDSwitcherRecordAVError error = bmdSwitcherRecordAVErrorNone;
			if (SUCCEEDED(recordInterface->GetStatus(&state, &error)))
			{
				switch (state)
				{
				case bmdSwitcherRecordAVStateIdle: gState.recordingStatus = "idle"; break;
				case bmdSwitcherRecordAVStateRecording: gState.recordingStatus = "recording"; break;
				case bmdSwitcherRecordAVStateStopping: gState.recordingStatus = "stopping"; break;
				default: gState.recordingStatus = "unknown"; break;
				}
				gState.lastError = recordAvErrorToString(error);
			}
		};

		if (queryActiveSwitcherLocked(gRecordAv))
		{
			updateRecordState(gRecordAv);
			return;
		}

		if (!queryActiveSwitcherLocked(gRecordAv901))
		{
			gState.isRecording = false;
			gState.recordingStatus = "unsupported";
			return;
		}

		updateRecordState(gRecordAv901);
	}

	void refreshStateLocked()
	{
		if (!hasActiveSwitcherLocked())
			return;
		logMessage("refreshState start");
		logMessage(refreshInputsLocked() ? "refreshInputs ok" : "refreshInputs failed");
		logMessage(refreshMixEffectLocked() ? "refreshMixEffect ok" : "refreshMixEffect failed");
		logMessage(gState.output4Supported ? "refreshOutput4 ok" : "refreshOutput4 unavailable");
		logMessage("refreshRecordState start");
		refreshRecordStateLocked();
		logMessage("refreshRecordState done");
		gState.lastCommandAt = nowIso();
		logMessage("refreshState done");
	}

	std::string extractJsonString(const std::string& body, const std::string& key)
	{
		const std::string needle = "\"" + key + "\"";
		size_t keyPos = body.find(needle);
		if (keyPos == std::string::npos)
			return {};
		size_t colonPos = body.find(':', keyPos + needle.size());
		if (colonPos == std::string::npos)
			return {};
		size_t firstQuote = body.find('"', colonPos + 1);
		if (firstQuote == std::string::npos)
			return {};
		size_t secondQuote = firstQuote + 1;
		while (secondQuote < body.size())
		{
			if (body[secondQuote] == '"' && body[secondQuote - 1] != '\\')
				break;
			++secondQuote;
		}
		if (secondQuote >= body.size())
			return {};
		return body.substr(firstQuote + 1, secondQuote - firstQuote - 1);
	}

	long long extractJsonNumber(const std::string& body, const std::string& key, long long fallback = 0)
	{
		const std::string needle = "\"" + key + "\"";
		size_t keyPos = body.find(needle);
		if (keyPos == std::string::npos)
			return fallback;
		size_t colonPos = body.find(':', keyPos + needle.size());
		if (colonPos == std::string::npos)
			return fallback;
		size_t start = colonPos + 1;
		while (start < body.size() && std::isspace(static_cast<unsigned char>(body[start])))
			++start;
		size_t end = start;
		while (end < body.size() && (std::isdigit(static_cast<unsigned char>(body[end])) || body[end] == '-'))
			++end;
		if (end == start)
			return fallback;
		return std::strtoll(body.substr(start, end - start).c_str(), nullptr, 10);
	}

	bool connectLocked(const std::string& ip, std::string& error)
	{
		logMessage(std::string("connectLocked start ip=") + ip);
		clearConnectionLocked();

		std::vector<std::string> diagnostics;
		BMDSwitcherConnectToFailure failReason = bmdSwitcherConnectToFailureNoResponse;
		BSTR address = SysAllocString(widen(ip).c_str());
		HRESULT result = E_FAIL;
		bool connected = false;

		auto tryVersionedConnect = [&](const char* label, const CLSID& clsid, const IID& iid) -> bool
		{
			diagnostics.push_back(std::string("Trying ") + label);
			ComPtr<IUnknown> unknownDiscovery;
			result = CoCreateInstance(clsid, nullptr, CLSCTX_ALL, iid, reinterpret_cast<void**>(unknownDiscovery.ReleaseAndGetAddressOf()));
			if (FAILED(result) || !unknownDiscovery)
			{
				diagnostics.push_back(std::string(label) + " discovery create failed: HRESULT " + formatHresult(result));
				return false;
			}

			if (iid == __uuidof(IBMDSwitcherDiscovery_v10_1_1))
			{
				ComPtr<IBMDSwitcherDiscovery_v10_1_1> discovery;
				ComPtr<IBMDSwitcher_v10_1_1> switcher;
				unknownDiscovery.As(&discovery);
				if (!discovery)
				{
					diagnostics.push_back(std::string(label) + " discovery cast failed");
					return false;
				}
				result = discovery->ConnectTo(address, switcher.GetAddressOf(), &failReason);
				if (FAILED(result) || !switcher)
				{
					diagnostics.push_back(std::string(label) + " ConnectTo failed: HRESULT " + formatHresult(result) + ", reason: " + connectFailReasonToString(failReason));
					return false;
				}
				gSwitcherApiVersion = SwitcherApiVersion::v10_1_1;
				gSwitcher1011 = switcher;
				diagnostics.push_back(std::string(label) + " ConnectTo succeeded");
				return true;
			}

			if (iid == __uuidof(IBMDSwitcherDiscovery_v9_8_3))
			{
				ComPtr<IBMDSwitcherDiscovery_v9_8_3> discovery;
				ComPtr<IBMDSwitcher_v9_8_3> switcher;
				unknownDiscovery.As(&discovery);
				if (!discovery)
				{
					diagnostics.push_back(std::string(label) + " discovery cast failed");
					return false;
				}
				result = discovery->ConnectTo(address, switcher.GetAddressOf(), &failReason);
				if (FAILED(result) || !switcher)
				{
					diagnostics.push_back(std::string(label) + " ConnectTo failed: HRESULT " + formatHresult(result) + ", reason: " + connectFailReasonToString(failReason));
					return false;
				}
				gSwitcherApiVersion = SwitcherApiVersion::v9_8_3;
				gSwitcher983 = switcher;
				diagnostics.push_back(std::string(label) + " ConnectTo succeeded");
				return true;
			}

			if (iid == __uuidof(IBMDSwitcherDiscovery_v9_6_3))
			{
				ComPtr<IBMDSwitcherDiscovery_v9_6_3> discovery;
				ComPtr<IBMDSwitcher_v9_6_3> switcher;
				unknownDiscovery.As(&discovery);
				if (!discovery)
				{
					diagnostics.push_back(std::string(label) + " discovery cast failed");
					return false;
				}
				result = discovery->ConnectTo(address, switcher.GetAddressOf(), &failReason);
				if (FAILED(result) || !switcher)
				{
					diagnostics.push_back(std::string(label) + " ConnectTo failed: HRESULT " + formatHresult(result) + ", reason: " + connectFailReasonToString(failReason));
					return false;
				}
				gSwitcherApiVersion = SwitcherApiVersion::v9_6_3;
				gSwitcher963 = switcher;
				diagnostics.push_back(std::string(label) + " ConnectTo succeeded");
				return true;
			}

			diagnostics.push_back(std::string(label) + " unsupported discovery/interface combination");
			return false;
		};

		connected = tryVersionedConnect("v10.1.1", __uuidof(CBMDSwitcherDiscovery_v10_1_1), __uuidof(IBMDSwitcherDiscovery_v10_1_1));
		if (!connected)
			connected = tryVersionedConnect("v9.8.3", __uuidof(CBMDSwitcherDiscovery_v9_8_3), __uuidof(IBMDSwitcherDiscovery_v9_8_3));
		if (!connected)
			connected = tryVersionedConnect("v9.6.3", __uuidof(CBMDSwitcherDiscovery_v9_6_3), __uuidof(IBMDSwitcherDiscovery_v9_6_3));
		if (!connected)
		{
			diagnostics.push_back("Trying base discovery interface");
			ComPtr<IBMDSwitcherDiscovery> discovery;
			result = CoCreateInstance(__uuidof(CBMDSwitcherDiscovery), nullptr, CLSCTX_ALL, __uuidof(IBMDSwitcherDiscovery), reinterpret_cast<void**>(discovery.GetAddressOf()));
			if (FAILED(result) || !discovery)
			{
				diagnostics.push_back(std::string("base discovery create failed: HRESULT ") + formatHresult(result));
			}
			else
			{
				result = discovery->ConnectTo(address, gSwitcher.GetAddressOf(), &failReason);
				connected = SUCCEEDED(result) && gSwitcher;
				if (!connected)
					diagnostics.push_back(std::string("base ConnectTo failed: HRESULT ") + formatHresult(result) + ", reason: " + connectFailReasonToString(failReason));
				else
				{
					gSwitcherApiVersion = SwitcherApiVersion::base;
					diagnostics.push_back("base ConnectTo succeeded");
				}
		}
		}

		SysFreeString(address);
		if (!connected || !hasActiveSwitcherLocked())
		{
			error = connectFailReasonToString(failReason);
			if (!diagnostics.empty())
				error += " | " + diagnostics[diagnostics.size() - 1];
			for (size_t i = 0; i + 1 < diagnostics.size(); ++i)
				error += " | " + diagnostics[i];
			clearConnectionLocked();
			gState.lastError = error;
			return false;
		}

		logMessage("connectLocked succeeded, refreshing state");
		gState.connected = true;
		gState.switcherIp = ip;
		gState.lastError = diagnostics.empty() ? std::string() : diagnostics[diagnostics.size() - 1];
		refreshStateLocked();
		return true;
	}
	bool ensureConnectedLocked(std::string& error)
	{
		if (gState.connected && hasActiveSwitcherLocked() && (gMixEffectBlock || gMixEffectBlock983 || gMixEffectBlock75))
			return true;
		error = "ATEM is not connected";
		return false;
	}

	void sendResponse(SOCKET client, int statusCode, const std::string& statusText, const std::string& body)
	{
		std::ostringstream response;
		response << "HTTP/1.1 " << statusCode << " " << statusText << "\r\n";
		response << "Content-Type: application/json\r\n";
		response << "Content-Length: " << body.size() << "\r\n";
		response << "Connection: close\r\n";
		response << "\r\n";
		response << body;
		const std::string data = response.str();
		send(client, data.c_str(), static_cast<int>(data.size()), 0);
	}

	std::string readRequest(SOCKET client)
	{
		std::string request;
		char buffer[4096];
		int contentLength = 0;
		bool haveHeaders = false;

		while (true)
		{
			int received = recv(client, buffer, sizeof(buffer), 0);
			if (received <= 0)
				break;
			request.append(buffer, buffer + received);

			if (!haveHeaders)
			{
				size_t pos = request.find("\r\n\r\n");
				if (pos != std::string::npos)
				{
					haveHeaders = true;
					size_t headerStart = 0;
					while (headerStart < pos)
					{
						size_t lineEnd = request.find("\r\n", headerStart);
						if (lineEnd == std::string::npos || lineEnd > pos)
							break;
						std::string line = request.substr(headerStart, lineEnd - headerStart);
						const std::string prefix = "Content-Length:";
						if (line.rfind(prefix, 0) == 0)
							contentLength = std::atoi(line.substr(prefix.size()).c_str());
						headerStart = lineEnd + 2;
					}
					const size_t bodyStart = pos + 4;
					if (request.size() >= bodyStart + static_cast<size_t>(contentLength))
						break;
				}
			}
		}

		return request;
	}

	void handleRequest(SOCKET client, const std::string& request)
	{
		size_t lineEnd = request.find("\r\n");
		if (lineEnd == std::string::npos)
		{
			sendResponse(client, 400, "Bad Request", "{\"error\":\"Invalid request\"}");
			return;
		}

		const std::string requestLine = request.substr(0, lineEnd);
		std::istringstream lineStream(requestLine);
		std::string method;
		std::string path;
		lineStream >> method >> path;

		size_t bodyPos = request.find("\r\n\r\n");
		const std::string body = bodyPos == std::string::npos ? std::string() : request.substr(bodyPos + 4);

		std::lock_guard<std::mutex> guard(gMutex);
		gState.lastCommandAt = nowIso();

		if (method == "GET" && path == "/health")
		{
			sendResponse(client, 200, "OK", "{\"ok\":true,\"mode\":\"sdk\"}");
			return;
		}

		if (method == "GET" && path == "/v1/state")
		{
			refreshStateLocked();
			sendResponse(client, 200, "OK", stateJsonLocked());
			return;
		}

		if (method == "GET" && path == "/v1/debug/inputs")
		{
			refreshStateLocked();
			sendResponse(client, 200, "OK", "{\"debug\":\"" + jsonEscape(gInputDiscoveryDebug) + "\"}");
			return;
		}

		if (method == "POST" && path == "/v1/connect")
		{
			const std::string ipAddress = extractJsonString(body, "ipAddress");
			if (ipAddress.empty())
			{
				sendResponse(client, 400, "Bad Request", "{\"error\":\"ipAddress is required\"}");
				return;
			}
			std::string error;
			if (!connectLocked(ipAddress, error))
			{
				gState.lastError = error;
				sendResponse(client, 500, "Internal Server Error", jsonErrorLocked(error));
				return;
			}
			sendResponse(client, 200, "OK", stateJsonLocked());
			return;
		}

		if (method == "POST" && path == "/v1/disconnect")
		{
			clearConnectionLocked();
			sendResponse(client, 200, "OK", stateJsonLocked());
			return;
		}

		std::string error;
		if (!ensureConnectedLocked(error))
		{
			sendResponse(client, 409, "Conflict", jsonErrorLocked(error));
			return;
		}

		if (method == "POST" && path == "/v1/preview")
		{
			const BMDSwitcherInputId inputId = static_cast<BMDSwitcherInputId>(extractJsonNumber(body, "inputId"));
			HRESULT hr = E_POINTER;
			if (gMixEffectBlock)
				hr = gMixEffectBlock->SetPreviewInput(inputId);
			else if (gMixEffectBlock983)
				hr = gMixEffectBlock983->SetPreviewInput(inputId);
			else if (gMixEffectBlock75)
				hr = gMixEffectBlock75->SetInt(bmdSwitcherMixEffectBlockPropertyIdPreviewInput_v7_5, inputId);
			if (FAILED(hr))
			{
				sendResponse(client, 500, "Internal Server Error", jsonErrorLocked("Failed to set preview input"));
				return;
			}
			refreshStateLocked();
			sendResponse(client, 200, "OK", stateJsonLocked());
			return;
		}

		if (method == "POST" && path == "/v1/program")
		{
			const BMDSwitcherInputId inputId = static_cast<BMDSwitcherInputId>(extractJsonNumber(body, "inputId"));
			HRESULT hr = E_POINTER;
			if (gMixEffectBlock)
				hr = gMixEffectBlock->SetProgramInput(inputId);
			else if (gMixEffectBlock983)
				hr = gMixEffectBlock983->SetProgramInput(inputId);
			else if (gMixEffectBlock75)
				hr = gMixEffectBlock75->SetInt(bmdSwitcherMixEffectBlockPropertyIdProgramInput_v7_5, inputId);
			if (FAILED(hr))
			{
				sendResponse(client, 500, "Internal Server Error", jsonErrorLocked("Failed to set program input"));
				return;
			}
			refreshStateLocked();
			sendResponse(client, 200, "OK", stateJsonLocked());
			return;
		}

		if (method == "POST" && path == "/v1/cut")
		{
			HRESULT hr = E_POINTER;
			if (gMixEffectBlock)
				hr = gMixEffectBlock->PerformCut();
			else if (gMixEffectBlock983)
				hr = gMixEffectBlock983->PerformCut();
			else if (gMixEffectBlock75)
				hr = gMixEffectBlock75->PerformCut();
			if (FAILED(hr))
			{
				sendResponse(client, 500, "Internal Server Error", jsonErrorLocked("Failed to perform cut"));
				return;
			}
			refreshStateLocked();
			sendResponse(client, 200, "OK", stateJsonLocked());
			return;
		}

		if (method == "POST" && path == "/v1/auto")
		{
			HRESULT hr = E_POINTER;
			if (gMixEffectBlock)
				hr = gMixEffectBlock->PerformAutoTransition();
			else if (gMixEffectBlock983)
				hr = gMixEffectBlock983->PerformAutoTransition();
			else if (gMixEffectBlock75)
				hr = gMixEffectBlock75->PerformAutoTransition();
			if (FAILED(hr))
			{
				sendResponse(client, 500, "Internal Server Error", jsonErrorLocked("Failed to perform auto transition"));
				return;
			}
			refreshStateLocked();
			sendResponse(client, 200, "OK", stateJsonLocked());
			return;
		}

		if ((method == "POST" && path == "/v1/record/filename") || (method == "POST" && path == "/v1/record/start") || (method == "POST" && path == "/v1/record/stop"))
		{
			if (!gRecordAv && !gRecordAv901)
			{
				sendResponse(client, 409, "Conflict", jsonErrorLocked("Recording is not supported on this switcher"));
				return;
			}
		}

		if (method == "POST" && path == "/v1/record/filename")
		{
			const std::string filename = extractJsonString(body, "filename");
			if (filename.empty())
			{
				sendResponse(client, 400, "Bad Request", "{\"error\":\"filename is required\"}");
				return;
			}
			const std::wstring wide = widen(filename);
			BSTR bstr = SysAllocString(wide.c_str());
			HRESULT hr = gRecordAv ? gRecordAv->SetFilename(bstr) : gRecordAv901->SetFilename(bstr);
			SysFreeString(bstr);
			if (FAILED(hr))
			{
				sendResponse(client, 500, "Internal Server Error", jsonErrorLocked("Failed to set recording filename"));
				return;
			}
			refreshStateLocked();
			sendResponse(client, 200, "OK", stateJsonLocked());
			return;
		}

		if (method == "POST" && path == "/v1/record/start")
		{
			HRESULT hr = gRecordAv ? gRecordAv->StartRecording() : gRecordAv901->StartRecording();
			if (FAILED(hr))
			{
				sendResponse(client, 500, "Internal Server Error", jsonErrorLocked("Failed to start recording"));
				return;
			}
			refreshStateLocked();
			sendResponse(client, 200, "OK", stateJsonLocked());
			return;
		}

		if (method == "POST" && path == "/v1/record/stop")
		{
			HRESULT hr = gRecordAv ? gRecordAv->StopRecording() : gRecordAv901->StopRecording();
			if (FAILED(hr))
			{
				sendResponse(client, 500, "Internal Server Error", jsonErrorLocked("Failed to stop recording"));
				return;
			}
			refreshStateLocked();
			sendResponse(client, 200, "OK", stateJsonLocked());
			return;
		}

		if (method == "POST" && path == "/v1/output4/mode")
		{
			const std::string mode = extractJsonString(body, "mode");
			if (!gState.output4Supported || (!gAuxOutput4 && !gAuxOutput4983))
			{
				sendResponse(client, 409, "Conflict", jsonErrorLocked("Output 4 routing is not supported on this switcher"));
				return;
			}
			const BMDSwitcherInputId targetInput = static_cast<BMDSwitcherInputId>(mode == "program" ? gOutput4ProgramSourceId : mode == "multiview" ? gOutput4MultiviewSourceId : 0);
			if (targetInput == 0)
			{
				sendResponse(client, 400, "Bad Request", jsonErrorLocked("mode must be program or multiview"));
				return;
			}

			HRESULT hr = E_POINTER;
			if (gAuxOutput4)
				hr = gAuxOutput4->SetInputSource(targetInput);
			else if (gAuxOutput4983)
				hr = gAuxOutput4983->SetInputSource(targetInput);
			if (FAILED(hr))
			{
				sendResponse(client, 500, "Internal Server Error", jsonErrorLocked("Failed to set Output 4 mode"));
				return;
			}
			refreshStateLocked();
			sendResponse(client, 200, "OK", stateJsonLocked());
			return;
		}

		sendResponse(client, 404, "Not Found", "{\"error\":\"Not found\"}");
	}
}

int main()
{
	HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
	if (FAILED(hr))
		return 1;

	WSADATA wsaData {};
	if (WSAStartup(MAKEWORD(2, 2), &wsaData) != 0)
	{
		CoUninitialize();
		return 1;
	}

	SOCKET listenSocket = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
	if (listenSocket == INVALID_SOCKET)
	{
		WSACleanup();
		CoUninitialize();
		return 1;
	}

	sockaddr_in service {};
	service.sin_family = AF_INET;
	service.sin_addr.s_addr = inet_addr("127.0.0.1");
	service.sin_port = htons(static_cast<u_short>(kDefaultPort));

	if (bind(listenSocket, reinterpret_cast<sockaddr*>(&service), sizeof(service)) == SOCKET_ERROR)
	{
		closesocket(listenSocket);
		WSACleanup();
		CoUninitialize();
		return 1;
	}

	if (listen(listenSocket, SOMAXCONN) == SOCKET_ERROR)
	{
		closesocket(listenSocket);
		WSACleanup();
		CoUninitialize();
		return 1;
	}

	while (true)
	{
		SOCKET client = accept(listenSocket, nullptr, nullptr);
		if (client == INVALID_SOCKET)
			continue;

		const std::string request = readRequest(client);
		handleRequest(client, request);
		shutdown(client, SD_BOTH);
		closesocket(client);
	}

	closesocket(listenSocket);
	WSACleanup();
	CoUninitialize();
	return 0;
}














