; CID EchoTrace Local uses the CUDA/cuBLAS DLLs packaged with the application.
; This page does not install a system-wide CUDA developer toolkit: the toolkit
; is not required to transcribe. It gives the installed edition an explicit,
; reversible choice to activate the complete local GPU runtime it carries.

!include "LogicLib.nsh"
!include "nsDialogs.nsh"

!ifndef BUILD_UNINSTALLER
  Var CudaRuntimeCheckbox

  !macro customPageAfterChangeDir
    Page custom CudaRuntimePage CudaRuntimePageLeave
  !macroend

  Function CudaRuntimePage
    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}

    ${NSD_CreateLabel} 0 0 100% 25u "NVIDIA GPU acceleration"
    Pop $0
    ${NSD_CreateLabel} 0 27u 100% 38u "CID EchoTrace Local already includes the CUDA 12.4 and cuBLAS runtime required for GPU transcription. No separate CUDA Toolkit download or system-wide developer installation is required."
    Pop $0
    ${NSD_CreateCheckbox} 0 70u 100% 16u "Enable the included CUDA runtime when an NVIDIA display driver is available (recommended)"
    Pop $CudaRuntimeCheckbox
    ${NSD_Check} $CudaRuntimeCheckbox
    nsDialogs::Show
  FunctionEnd

  Function CudaRuntimePageLeave
    ${NSD_GetState} $CudaRuntimeCheckbox $0
    ${If} $0 == ${BST_CHECKED}
      WriteRegDWORD HKCU "Software\CID EchoTrace Local" "UseCuda" 1
    ${Else}
      WriteRegDWORD HKCU "Software\CID EchoTrace Local" "UseCuda" 0
    ${EndIf}
  FunctionEnd
!else
  !macro customUnInstall
    DeleteRegValue HKCU "Software\CID EchoTrace Local" "UseCuda"
    DeleteRegKey /ifempty HKCU "Software\CID EchoTrace Local"
  !macroend
!endif
